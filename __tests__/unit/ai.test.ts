import { test, expect, describe, afterEach, mock } from "bun:test";
import { generateResponse } from "../../convex/lib/ai";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(responseBody: unknown, ok = true, status = 200) {
  const fn = mock(() =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(responseBody),
      text: () => Promise.resolve(JSON.stringify(responseBody)),
    } as Response),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

interface MockResponse {
  body: unknown;
  ok?: boolean;
  status?: number;
}

function mockFetchSequence(responses: MockResponse[]) {
  let callIndex = 0;
  const fallback: MockResponse = { body: {} };
  const fn = mock(() => {
    const idx = Math.min(callIndex, responses.length - 1);
    const resp = responses[idx] ?? fallback;
    callIndex++;
    return Promise.resolve({
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(JSON.stringify(resp.body)),
    } as Response);
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function getCallArgs(fn: ReturnType<typeof mock>): [string, RequestInit] {
  const call = fn.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  return call as unknown as [string, RequestInit];
}

function getNthCallArgs(fn: ReturnType<typeof mock>, n: number): [string, RequestInit] {
  const call = fn.mock.calls[n];
  if (!call) throw new Error(`fetch call ${n} not found`);
  return call as unknown as [string, RequestInit];
}

function getCallBody(fn: ReturnType<typeof mock>) {
  const [, options] = getCallArgs(fn);
  return JSON.parse(options.body as string);
}

function getNthCallBody(fn: ReturnType<typeof mock>, n: number) {
  const [, options] = getNthCallArgs(fn, n);
  return JSON.parse(options.body as string);
}

async function withEnv(
  name: string,
  value: string,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    await fn();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = previous;
    }
  }
}

describe("generateResponse", () => {
  test("throws on unknown provider", async () => {
    expect(generateResponse("unknown", "key", "model", "prompt", [])).rejects.toThrow(
      "Unknown AI provider: unknown",
    );
  });

  describe("claude provider", () => {
    test("calls Anthropic API with correct URL and headers", async () => {
      const fetchMock = mockFetch({
        content: [{ text: "Hello from Claude" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await generateResponse(
        "claude",
        "sk-ant-test",
        "claude-sonnet-4-20250514",
        "Be helpful",
        [{ role: "user", content: "Hi" }],
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(options.method).toBe("POST");

      const headers = options.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
    });

    test("sends system prompt and messages in request body", async () => {
      const fetchMock = mockFetch({
        content: [{ text: "response" }],
        usage: {},
      });

      await generateResponse("claude", "key", "model", "You are a bot", [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);

      const body = getCallBody(fetchMock);
      expect(body.system).toBe("You are a bot");
      expect(body.model).toBe("model");
      expect(body.max_tokens).toBe(1024);
      expect(body.messages).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);
    });

    test("maps image content parts for Claude", async () => {
      const fetchMock = mockFetch({
        content: [{ text: "response" }],
        usage: {},
      });

      await generateResponse("claude", "key", "model", "prompt", [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            { type: "image", mediaType: "image/jpeg", data: "AQID" },
          ],
        },
      ]);

      const body = getCallBody(fetchMock);
      expect(body.messages[0].content).toEqual([
        { type: "text", text: "Describe this image" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: "AQID" },
        },
      ]);
    });

    test("returns parsed response with token counts", async () => {
      mockFetch({
        content: [{ text: "Hello!" }],
        usage: { input_tokens: 15, output_tokens: 3 },
      });

      const result = await generateResponse("claude", "key", "model", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      expect(result.text).toBe("Hello!");
      expect(result.inputTokens).toBe(15);
      expect(result.outputTokens).toBe(3);
    });

    test("throws on API error", async () => {
      mockFetch({ error: "rate limited" }, false, 429);

      expect(
        generateResponse("claude", "key", "model", "prompt", [
          { role: "user", content: "Hi" },
        ]),
      ).rejects.toThrow("Claude API error: 429");
    });
  });

  describe("moonshot provider", () => {
    test("calls Moonshot API URL", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "Hello from Kimi" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await generateResponse("moonshot", "msk-test", "kimi-k2-0711-preview", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    });

    test("sends Bearer auth header", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "response" } }],
        usage: {},
      });

      await generateResponse("moonshot", "msk-test", "model", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      const [, options] = getCallArgs(fetchMock);
      const headers = options.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer msk-test");
    });

    test("includes system message in messages array", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "response" } }],
        usage: {},
      });

      await generateResponse("moonshot", "key", "model", "Be nerdbot", [
        { role: "user", content: "Hello" },
      ]);

      const body = getCallBody(fetchMock);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be nerdbot" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
    });

    test("includes thinking config when provided", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "response" } }],
        usage: {},
      });

      await generateResponse(
        "moonshot",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "Hello" }],
        { thinking: "disabled" },
      );

      const body = getCallBody(fetchMock);
      expect(body.thinking).toEqual({ type: "disabled" });
    });

    test("returns parsed OpenAI-format response", async () => {
      mockFetch({
        choices: [{ message: { content: "Kimi says hi" } }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      });

      const result = await generateResponse("moonshot", "key", "model", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      expect(result.text).toBe("Kimi says hi");
      expect(result.inputTokens).toBe(20);
      expect(result.outputTokens).toBe(8);
    });

    test("throws on API error with provider name", async () => {
      mockFetch({ error: "bad request" }, false, 400);

      expect(
        generateResponse("moonshot", "key", "model", "prompt", [
          { role: "user", content: "Hi" },
        ]),
      ).rejects.toThrow("moonshot API error: 400");
    });
  });

  describe("openai provider", () => {
    test("calls OpenAI API URL", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "Hello from GPT" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await generateResponse("openai", "sk-test", "gpt-4o", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
    });

    test("respects OPENAI_BASE_URL override", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "Hello from proxy" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await withEnv("OPENAI_BASE_URL", "https://openai.proxy/v1/", async () => {
        await generateResponse("openai", "sk-test", "gpt-4o", "prompt", [
          { role: "user", content: "Hi" },
        ]);
      });

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://openai.proxy/v1/chat/completions");
    });

    test("maps image content parts for OpenAI-compatible API", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "response" } }],
        usage: {},
      });

      await generateResponse("openai", "sk-test", "gpt-4o", "prompt", [
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this?" },
            { type: "image", mediaType: "image/png", data: "AQID" },
          ],
        },
      ]);

      const body = getCallBody(fetchMock);
      expect(body.messages[1].content).toEqual([
        { type: "text", text: "What's in this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      ]);
    });
  });

  describe("grok provider", () => {
    test("calls xAI API URL", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "Hello from Grok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await generateResponse("grok", "xai-test-key", "grok-4-1-fast", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.x.ai/v1/chat/completions");
    });

    test("sends Bearer auth header", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "response" } }],
        usage: {},
      });

      await generateResponse("grok", "xai-test-key", "model", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      const [, options] = getCallArgs(fetchMock);
      const headers = options.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer xai-test-key");
    });

    test("includes system message in messages array", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "response" } }],
        usage: {},
      });

      await generateResponse("grok", "key", "model", "Be nerdbot", [
        { role: "user", content: "Hello" },
      ]);

      const body = getCallBody(fetchMock);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be nerdbot" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
    });

    test("returns parsed OpenAI-format response", async () => {
      mockFetch({
        choices: [{ message: { content: "Grok says hi" } }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      });

      const result = await generateResponse("grok", "key", "model", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      expect(result.text).toBe("Grok says hi");
      expect(result.inputTokens).toBe(20);
      expect(result.outputTokens).toBe(8);
    });

    test("throws on API error with provider name", async () => {
      mockFetch({ error: "bad request" }, false, 400);

      expect(
        generateResponse("grok", "key", "model", "prompt", [
          { role: "user", content: "Hi" },
        ]),
      ).rejects.toThrow("grok API error: 400");
    });
  });

  describe("grok web search", () => {
    test("calls Responses API endpoint when webSearch is enabled", async () => {
      const fetchMock = mockFetch({
        id: "resp_123",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Search result" }],
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await generateResponse(
        "grok",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "search this" }],
        { webSearch: true },
      );

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.x.ai/v1/responses");
    });

    test("sends correct request body with tools and store:false", async () => {
      const fetchMock = mockFetch({
        id: "resp_123",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Answer" }],
          },
        ],
        usage: {},
      });

      await generateResponse(
        "grok",
        "key",
        "grok-4-1-fast",
        "Be helpful",
        [{ role: "user", content: "What is X?" }],
        { webSearch: true },
      );

      const body = getCallBody(fetchMock);
      expect(body.model).toBe("grok-4-1-fast");
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(body.store).toBe(false);
      expect(body.input[0]).toEqual({ role: "system", content: "Be helpful" });
      expect(body.input[1]).toEqual({ role: "user", content: "What is X?" });
    });

    test("extracts text from message output", async () => {
      mockFetch({
        id: "resp_123",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "The answer is 42" }],
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 8 },
      });

      const result = await generateResponse(
        "grok",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "question" }],
        { webSearch: true },
      );

      expect(result.text).toBe("The answer is 42");
      expect(result.inputTokens).toBe(15);
      expect(result.outputTokens).toBe(8);
    });

    test("handles response with web_search_call outputs", async () => {
      mockFetch({
        id: "resp_123",
        output: [
          { type: "web_search_call" },
          {
            type: "message",
            content: [{ type: "output_text", text: "Found via search" }],
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      });

      const result = await generateResponse(
        "grok",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "search" }],
        { webSearch: true },
      );

      expect(result.text).toBe("Found via search");
      expect(result.webSearchQueries).toBeDefined();
      expect(result.webSearchQueries).toHaveLength(1);
    });

    test("returns no webSearchQueries when no search was performed", async () => {
      mockFetch({
        id: "resp_123",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Direct answer" }],
          },
        ],
        usage: {},
      });

      const result = await generateResponse(
        "grok",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "hi" }],
        { webSearch: true },
      );

      expect(result.text).toBe("Direct answer");
      expect(result.webSearchQueries).toBeUndefined();
    });

    test("throws on API error", async () => {
      mockFetch({ error: "rate limited" }, false, 429);

      await expect(
        generateResponse(
          "grok",
          "key",
          "model",
          "prompt",
          [{ role: "user", content: "search" }],
          { webSearch: true },
        ),
      ).rejects.toThrow("grok API error: 429");
    });

    test("returns empty string when output has no message", async () => {
      mockFetch({
        id: "resp_123",
        output: [{ type: "web_search_call" }],
        usage: {},
      });

      const result = await generateResponse(
        "grok",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "search" }],
        { webSearch: true },
      );

      expect(result.text).toBe("");
    });

    test("uses chat completions when webSearch is false", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "no search" } }],
        usage: {},
      });

      await generateResponse(
        "grok",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "Hi" }],
        { webSearch: false },
      );

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.x.ai/v1/chat/completions");
      const body = getCallBody(fetchMock);
      expect(body.tools).toBeUndefined();
    });
  });

  describe("openai web search", () => {
    test("calls Responses API endpoint when webSearch is enabled", async () => {
      const fetchMock = mockFetch({
        id: "resp_456",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "OpenAI search result" }],
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await generateResponse(
        "openai",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "search this" }],
        { webSearch: true },
      );

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.openai.com/v1/responses");
    });

    test("uses OPENAI_BASE_URL for Responses API", async () => {
      const fetchMock = mockFetch({
        id: "resp_456",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Proxy response" }],
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await withEnv("OPENAI_BASE_URL", "https://openai.proxy/v1", async () => {
        await generateResponse(
          "openai",
          "key",
          "model",
          "prompt",
          [{ role: "user", content: "search this" }],
          { webSearch: true },
        );
      });

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://openai.proxy/v1/responses");
    });

    test("sends correct request body with tools and store:false", async () => {
      const fetchMock = mockFetch({
        id: "resp_456",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Answer" }],
          },
        ],
        usage: {},
      });

      await generateResponse(
        "openai",
        "key",
        "gpt-4o",
        "Be helpful",
        [{ role: "user", content: "What is X?" }],
        { webSearch: true },
      );

      const body = getCallBody(fetchMock);
      expect(body.model).toBe("gpt-4o");
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(body.store).toBe(false);
      expect(body.input[0]).toEqual({ role: "system", content: "Be helpful" });
      expect(body.input[1]).toEqual({ role: "user", content: "What is X?" });
    });

    test("extracts text from message output", async () => {
      mockFetch({
        id: "resp_456",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "The answer is 42" }],
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 8 },
      });

      const result = await generateResponse(
        "openai",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "question" }],
        { webSearch: true },
      );

      expect(result.text).toBe("The answer is 42");
      expect(result.inputTokens).toBe(15);
      expect(result.outputTokens).toBe(8);
    });

    test("throws on API error", async () => {
      mockFetch({ error: "rate limited" }, false, 429);

      await expect(
        generateResponse(
          "openai",
          "key",
          "model",
          "prompt",
          [{ role: "user", content: "search" }],
          { webSearch: true },
        ),
      ).rejects.toThrow("openai API error: 429");
    });

    test("uses chat completions when webSearch is false", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "no search" } }],
        usage: {},
      });

      await generateResponse(
        "openai",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "Hi" }],
        { webSearch: false },
      );

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      const body = getCallBody(fetchMock);
      expect(body.tools).toBeUndefined();
    });
  });

  describe("moonshot web search", () => {
    test("includes tools array when webSearch is enabled", async () => {
      const fetchMock = mockFetch({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Direct answer" },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await generateResponse(
        "moonshot",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "Hi" }],
        { webSearch: true },
      );

      const body = getCallBody(fetchMock);
      expect(body.tools).toEqual([
        {
          type: "builtin_function",
          function: { name: "$web_search" },
        },
      ]);
    });

    test("returns immediately on finish_reason stop", async () => {
      const fetchMock = mockFetch({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Direct answer" },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await generateResponse(
        "moonshot",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "Hi" }],
        { webSearch: true },
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.text).toBe("Direct answer");
      expect(result.inputTokens).toBe(10);
      expect(result.outputTokens).toBe(5);
    });

    test("handles single tool-call iteration", async () => {
      const fetchMock = mockFetchSequence([
        {
          body: {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "$web_search",
                        arguments: '{"query":"test"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        },
        {
          body: {
            choices: [
              {
                finish_reason: "stop",
                message: { content: "Answer after search" },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10 },
          },
        },
      ]);

      const result = await generateResponse(
        "moonshot",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "search this" }],
        { webSearch: true },
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.text).toBe("Answer after search");

      // Verify second call includes tool messages
      const body = getNthCallBody(fetchMock, 1);
      const messages = body.messages;
      const assistantMsg = messages.find((m: { tool_calls?: unknown[] }) => m.tool_calls);
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.role).toBe("assistant");

      const toolMsg = messages.find((m: { role: string }) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe("call_1");
      expect(toolMsg.name).toBe("$web_search");
    });

    test("handles multiple tool-call iterations", async () => {
      const fetchMock = mockFetchSequence([
        {
          body: {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "$web_search",
                        arguments: '{"query":"first"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        },
        {
          body: {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_2",
                      type: "function",
                      function: {
                        name: "$web_search",
                        arguments: '{"query":"second"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 15, completion_tokens: 5 },
          },
        },
        {
          body: {
            choices: [
              {
                finish_reason: "stop",
                message: { content: "Final answer" },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10 },
          },
        },
      ]);

      const result = await generateResponse(
        "moonshot",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "search" }],
        { webSearch: true },
      );

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.text).toBe("Final answer");
    });

    test("accumulates token usage across iterations", async () => {
      mockFetchSequence([
        {
          body: {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "$web_search",
                        arguments: '{"query":"q"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        },
        {
          body: {
            choices: [
              {
                finish_reason: "stop",
                message: { content: "done" },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 8 },
          },
        },
      ]);

      const result = await generateResponse(
        "moonshot",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "search" }],
        { webSearch: true },
      );

      expect(result.inputTokens).toBe(30);
      expect(result.outputTokens).toBe(13);
    });

    test("throws on max iterations exceeded", async () => {
      // All responses are tool_calls — never resolves
      const toolCallResponse = {
        body: {
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_loop",
                    type: "function",
                    function: {
                      name: "$web_search",
                      arguments: '{"query":"loop"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      };

      mockFetchSequence([
        toolCallResponse,
        toolCallResponse,
        toolCallResponse,
        toolCallResponse,
        toolCallResponse,
      ]);

      await expect(
        generateResponse(
          "moonshot",
          "key",
          "model",
          "prompt",
          [{ role: "user", content: "loop" }],
          { webSearch: true },
        ),
      ).rejects.toThrow("exceeded maximum iterations");
    });

    test("throws on API error during loop", async () => {
      mockFetchSequence([
        {
          body: {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "$web_search",
                        arguments: '{"query":"q"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        },
        { body: { error: "server error" }, ok: false, status: 500 },
      ]);

      await expect(
        generateResponse(
          "moonshot",
          "key",
          "model",
          "prompt",
          [{ role: "user", content: "Hi" }],
          { webSearch: true },
        ),
      ).rejects.toThrow("moonshot API error: 500");
    });

    test("does not send tools when webSearch is false", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "response" } }],
        usage: {},
      });

      await generateResponse(
        "moonshot",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "Hi" }],
        { webSearch: false },
      );

      const body = getCallBody(fetchMock);
      expect(body.tools).toBeUndefined();
    });

    test("does not send tools when options omitted", async () => {
      const fetchMock = mockFetch({
        choices: [{ message: { content: "response" } }],
        usage: {},
      });

      await generateResponse("moonshot", "key", "model", "prompt", [
        { role: "user", content: "Hi" },
      ]);

      const body = getCallBody(fetchMock);
      expect(body.tools).toBeUndefined();
    });

    test("openai provider uses Responses API when webSearch is enabled", async () => {
      const fetchMock = mockFetch({
        id: "resp_123",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Searched result" }],
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await generateResponse(
        "openai",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "Hi" }],
        { webSearch: true },
      );

      const [url] = getCallArgs(fetchMock);
      expect(url).toBe("https://api.openai.com/v1/responses");
    });

    test("handles unexpected finish_reason gracefully", async () => {
      mockFetch({
        choices: [
          {
            finish_reason: "length",
            message: { content: "Truncated response" },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 100 },
      });

      const result = await generateResponse(
        "moonshot",
        "key",
        "model",
        "prompt",
        [{ role: "user", content: "Hi" }],
        { webSearch: true },
      );

      expect(result.text).toBe("Truncated response");
    });

    test("throws when response has no choices", async () => {
      mockFetch({
        choices: [],
        usage: {},
      });

      await expect(
        generateResponse(
          "moonshot",
          "key",
          "model",
          "prompt",
          [{ role: "user", content: "Hi" }],
          { webSearch: true },
        ),
      ).rejects.toThrow("moonshot API returned no choices");
    });
  });
});
