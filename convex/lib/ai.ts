export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  webSearchQueries?: string[];
}

export type ThinkingMode = "disabled" | "enabled" | "auto";

export interface GenerateResponseOptions {
  webSearch?: boolean;
  thinking?: ThinkingMode;
}

interface ClaudeAPIResponse {
  content: { text: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIAPIResponse {
  choices: {
    finish_reason: string;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAIRequestMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface MoonshotTool {
  type: "builtin_function";
  function: { name: string };
}

interface ResponsesAPIOutputText {
  type: "output_text";
  text: string;
}

interface ResponsesAPIMessageOutput {
  type: "message";
  content: ResponsesAPIOutputText[];
}

interface ResponsesAPIWebSearchOutput {
  type: "web_search_call";
}

type ResponsesAPIOutput = ResponsesAPIMessageOutput | ResponsesAPIWebSearchOutput;

interface ResponsesAPIResponse {
  id: string;
  output: ResponsesAPIOutput[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function callClaude(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ConversationMessage[],
): Promise<AIResponse> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as ClaudeAPIResponse;
  const text = data.content[0]?.text ?? "";
  return {
    text,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  };
}

const OPENAI_COMPATIBLE_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  moonshot: "https://api.moonshot.ai/v1/chat/completions",
  grok: "https://api.x.ai/v1/chat/completions",
};

async function callOpenAICompatible(
  provider: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ConversationMessage[],
  thinking?: ThinkingMode,
): Promise<AIResponse> {
  const url = OPENAI_COMPATIBLE_ENDPOINTS[provider];
  if (!url) {
    throw new Error(`No endpoint configured for provider: ${provider}`);
  }

  const payload: {
    model: string;
    max_tokens: number;
    messages: OpenAIRequestMessage[];
    thinking?: { type: ThinkingMode };
  } = {
    model,
    max_tokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ],
  };

  if (provider === "moonshot" && thinking) {
    payload.thinking = { type: thinking };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${provider} API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as OpenAIAPIResponse;
  const text = data.choices[0]?.message.content ?? "";
  return {
    text,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

const MAX_TOOL_ITERATIONS = 5;

async function callMoonshotWithSearch(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ConversationMessage[],
  thinking?: ThinkingMode,
): Promise<AIResponse> {
  const url = OPENAI_COMPATIBLE_ENDPOINTS.moonshot;
  if (!url) {
    throw new Error("No endpoint configured for provider: moonshot");
  }

  const tools: MoonshotTool[] = [
    { type: "builtin_function", function: { name: "$web_search" } },
  ];

  const apiMessages: OpenAIRequestMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const searchQueries: string[] = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: apiMessages,
        tools,
        ...(thinking && { thinking: { type: thinking } }),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`moonshot API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenAIAPIResponse;

    totalInputTokens += data.usage?.prompt_tokens ?? 0;
    totalOutputTokens += data.usage?.completion_tokens ?? 0;

    const choice = data.choices[0];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!choice) {
      throw new Error("moonshot API returned no choices");
    }

    if (choice.finish_reason === "stop") {
      return {
        text: choice.message.content ?? "",
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        ...(searchQueries.length > 0 && {
          webSearchQueries: searchQueries,
        }),
      };
    }

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        searchQueries.push(toolCall.function.arguments);
      }

      apiMessages.push({
        role: "assistant",
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });

      for (const toolCall of choice.message.tool_calls) {
        apiMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: toolCall.function.arguments,
        });
      }

      continue;
    }

    // Unexpected finish_reason — return whatever content we have
    return {
      text: choice.message.content ?? "",
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      ...(searchQueries.length > 0 && {
        webSearchQueries: searchQueries,
      }),
    };
  }

  throw new Error("moonshot web search exceeded maximum iterations");
}

const RESPONSES_API_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1/responses",
  grok: "https://api.x.ai/v1/responses",
};

async function callResponsesAPIWithSearch(
  provider: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ConversationMessage[],
): Promise<AIResponse> {
  const url = RESPONSES_API_ENDPOINTS[provider];
  if (!url) {
    throw new Error(`No Responses API endpoint configured for provider: ${provider}`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
      tools: [{ type: "web_search" }],
      store: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${provider} API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as ResponsesAPIResponse;

  const messageOutput = data.output.find(
    (item): item is ResponsesAPIMessageOutput => item.type === "message",
  );
  const text = messageOutput?.content[0]?.text ?? "";

  const searchCalls = data.output.filter((item) => item.type === "web_search_call");

  return {
    text,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
    ...(searchCalls.length > 0 && {
      webSearchQueries: [`web_search (${searchCalls.length} call(s))`],
    }),
  };
}

export async function generateResponse(
  provider: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ConversationMessage[],
  options?: GenerateResponseOptions,
): Promise<AIResponse> {
  switch (provider) {
    case "claude":
      return callClaude(apiKey, model, systemPrompt, messages);
    case "moonshot":
      if (options?.webSearch) {
        return callMoonshotWithSearch(
          apiKey,
          model,
          systemPrompt,
          messages,
          options.thinking,
        );
      }
      return callOpenAICompatible(
        provider,
        apiKey,
        model,
        systemPrompt,
        messages,
        options?.thinking,
      );
    case "grok":
      if (options?.webSearch) {
        return callResponsesAPIWithSearch(
          provider,
          apiKey,
          model,
          systemPrompt,
          messages,
        );
      }
      return callOpenAICompatible(
        provider,
        apiKey,
        model,
        systemPrompt,
        messages,
        options?.thinking,
      );
    case "openai":
      if (options?.webSearch) {
        return callResponsesAPIWithSearch(
          provider,
          apiKey,
          model,
          systemPrompt,
          messages,
        );
      }
      return callOpenAICompatible(
        provider,
        apiKey,
        model,
        systemPrompt,
        messages,
        options?.thinking,
      );
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}
