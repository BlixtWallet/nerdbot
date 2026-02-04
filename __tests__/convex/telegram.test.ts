import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { modules } from "./test.setup";

// --- Helpers ---

interface FetchCall {
  url: string;
  body: unknown;
}

function mockFetchForAI(aiResponseText: string, inputTokens = 10, outputTokens = 20) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });

      if (url.includes("/getFile")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { file_path: "photos/file.jpg", file_size: 3 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.includes("api.telegram.org/file/bot")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }

      // Telegram API calls (sendChatAction, sendMessage)
      if (url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Responses API call (web search) — OpenAI and xAI
      if (url.includes("/v1/responses")) {
        return new Response(
          JSON.stringify({
            id: "resp_test",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: aiResponseText }],
              },
            ],
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Moonshot / OpenAI-compatible API call
      if (url.includes("chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { role: "assistant", content: aiResponseText },
              },
            ],
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Claude API call
      if (url.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            content: [{ text: aiResponseText }],
            usage: {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response("Not found", { status: 404 });
    }),
  );
  return calls;
}

function mockFetchForIssue(
  aiResponseJson: string,
  githubIssue = {
    html_url: "https://github.com/owner/repo/issues/1",
    number: 1,
    title: "Test Issue",
  },
) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });

      // Telegram API calls
      if (url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GitHub API call
      if (url.includes("api.github.com")) {
        return new Response(JSON.stringify(githubIssue), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Moonshot / OpenAI-compatible API call
      if (url.includes("chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { role: "assistant", content: aiResponseJson },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Claude API call
      if (url.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            content: [{ text: aiResponseJson }],
            usage: { input_tokens: 10, output_tokens: 20 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response("Not found", { status: 404 });
    }),
  );
  return calls;
}

function mockFetchForAIError(errorMessage: string) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });

      // Telegram API calls always succeed
      if (url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // AI API fails
      return new Response(errorMessage, { status: 500 });
    }),
  );
  return calls;
}

// --- Setup ---

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("AI_PROVIDER", "moonshot");
  vi.stubEnv("AI_API_KEY", "test-api-key");
  vi.stubEnv("AI_MODEL", "test-model");
  vi.stubEnv("MAX_CONTEXT_MESSAGES", "15");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// --- Tests ---

describe("processMessage", () => {
  it("sends typing action, generates AI response, stores it, and replies", async () => {
    const t = convexTest(schema, modules);
    // Pre-populate a user message for context
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "What is TypeScript?",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAI("TypeScript is a typed superset of JavaScript.");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "What is TypeScript?",
      messageId: 1,
    });

    // 1. Should have sent typing action
    const typingCalls = calls.filter((c) => c.url.includes("/sendChatAction"));
    expect(typingCalls).toHaveLength(1);

    // 2. Should have called AI API
    const aiCalls = calls.filter((c) => c.url.includes("chat/completions"));
    expect(aiCalls).toHaveLength(1);

    // 3. Should have sent the response via Telegram
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls).toHaveLength(1);
    expect((sendCalls[0]!.body as Record<string, unknown>).text).toBe(
      "TypeScript is a typed superset of JavaScript.",
    );

    // 4. Should have stored the assistant message in DB
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]!.text).toBe(
      "TypeScript is a typed superset of JavaScript.",
    );
  });

  it("includes image content when image metadata is provided", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_MODEL", "gpt-4o");
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "[Image] what is this",
      userId: 1,
      userName: "Alice",
      telegramMessageId: 42,
    });

    const calls = mockFetchForAI("Looks like a test image.");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "what is this",
      messageId: 42,
      image: { fileId: "file-123", mimeType: "image/png" },
    });

    const aiCalls = calls.filter((c) => c.url.includes("chat/completions"));
    expect(aiCalls).toHaveLength(1);
    const body = aiCalls[0]!.body as Record<string, unknown>;
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const userMessage = messages[1] as { content: unknown };
    expect(userMessage.content).toEqual([
      { type: "text", text: "[Alice]: [Image] what is this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
  });

  it("replies with unsupported message when provider lacks image support", async () => {
    const t = convexTest(schema, modules);
    const calls = mockFetchForAI("Should not be called.");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "what is this",
      messageId: 99,
      image: { fileId: "file-123", mimeType: "image/png" },
    });

    const aiCalls = calls.filter((c) => c.url.includes("chat/completions"));
    expect(aiCalls).toHaveLength(0);
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls).toHaveLength(1);
    expect((sendCalls[0]!.body as Record<string, unknown>).text).toContain(
      "Image understanding isn't supported",
    );
  });

  it("uses chat config system prompt when available", async () => {
    const t = convexTest(schema, modules);
    // Create a chat with custom system prompt
    await t.run(async (ctx) => {
      await ctx.db.insert("chats", {
        chatId: 100,
        chatTitle: "Test",
        systemPrompt: "You are a helpful pirate.",
        enabled: true,
        createdAt: Date.now(),
      });
    });

    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Ahoy!",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAI("Arrr, matey!");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Ahoy!",
      messageId: 1,
    });

    // Verify the AI call included the custom system prompt
    const aiCall = calls.find((c) => c.url.includes("chat/completions"));
    const body = aiCall?.body as Record<string, unknown>;
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(String(messages[0]?.content)).toContain("You are a helpful pirate.");
    expect(String(messages[0]?.content)).toContain("Reply only to the most recent");
  });

  it("uses custom maxContextMessages from chat config", async () => {
    const t = convexTest(schema, modules);
    // Create chat with maxContextMessages = 2
    await t.run(async (ctx) => {
      await ctx.db.insert("chats", {
        chatId: 100,
        chatTitle: "Test",
        maxContextMessages: 2,
        enabled: true,
        createdAt: Date.now(),
      });
    });

    // Store 5 messages
    for (let i = 0; i < 5; i++) {
      await t.mutation(internal.messages.store, {
        chatId: 100,
        role: "user",
        text: `Message ${i}`,
        userId: 1,
        userName: "Alice",
      });
    }

    const calls = mockFetchForAI("Got it.");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Message 4",
      messageId: 1,
    });

    // Should only include 2 context messages (plus system prompt)
    const aiCall = calls.find((c) => c.url.includes("chat/completions"));
    const body = aiCall?.body as Record<string, unknown>;
    const messages = body.messages as Array<{ role: string; content: string }>;
    // 1 system + 2 context messages
    expect(messages).toHaveLength(3);
  });

  it("sends error message when AI API fails", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Hello",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAIError("Internal Server Error");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Hello",
      messageId: 1,
    });

    // Should have sent an error reply
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);
    const errorMsg = sendCalls.find((c) =>
      ((c.body as Record<string, unknown>).text as string).includes("error"),
    );
    expect(errorMsg).toBeDefined();
  });

  it("does not store assistant message on AI failure", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Hello",
      userId: 1,
      userName: "Alice",
    });

    mockFetchForAIError("Internal Server Error");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Hello",
      messageId: 1,
    });

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(0);
  });

  it("replies to the correct message with replyToMessageId", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Hey",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAI("Hello!");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Hey",
      messageId: 42,
    });

    const sendCall = calls.find((c) => c.url.includes("/sendMessage"));
    const body = sendCall?.body as Record<string, unknown>;
    expect(body.reply_parameters).toEqual({ message_id: 42 });
  });

  it("includes messageThreadId for forum topics", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 7,
      role: "user",
      text: "Topic message",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAI("Reply in topic.");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Topic message",
      messageId: 1,
      messageThreadId: 7,
    });

    // Typing action should include thread id
    const typingCall = calls.find((c) => c.url.includes("/sendChatAction"));
    expect((typingCall?.body as Record<string, unknown>).message_thread_id).toBe(7);

    // Reply should include thread id
    const sendCall = calls.find((c) => c.url.includes("/sendMessage"));
    expect((sendCall?.body as Record<string, unknown>).message_thread_id).toBe(7);
  });

  it("works with grok provider", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("AI_PROVIDER", "grok");
    vi.stubEnv("AI_MODEL", "grok-4-1-fast");

    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Hello Grok",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAI("Hello from Grok!");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Hello Grok",
      messageId: 1,
    });

    // Should have called xAI API
    const aiCalls = calls.filter((c) => c.url.includes("api.x.ai"));
    expect(aiCalls).toHaveLength(1);

    // Should have stored the response
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    expect(assistantMessages[0]!.text).toBe("Hello from Grok!");
  });

  it("works with grok provider and web search", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("AI_PROVIDER", "grok");
    vi.stubEnv("AI_MODEL", "grok-4-1-fast");
    vi.stubEnv("WEB_SEARCH", "true");

    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Search something",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAI("Found via search!");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Search something",
      messageId: 1,
    });

    // Should have called the Responses API
    const aiCalls = calls.filter((c) => c.url.includes("api.x.ai/v1/responses"));
    expect(aiCalls).toHaveLength(1);

    // Should have stored the response
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    expect(assistantMessages[0]!.text).toBe("Found via search!");
  });

  it("works with openai provider and web search", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_MODEL", "gpt-4o");
    vi.stubEnv("WEB_SEARCH", "true");

    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Search something",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAI("Found via OpenAI search!");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Search something",
      messageId: 1,
    });

    // Should have called the OpenAI Responses API
    const aiCalls = calls.filter((c) => c.url.includes("api.openai.com/v1/responses"));
    expect(aiCalls).toHaveLength(1);

    // Should have stored the response
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    expect(assistantMessages[0]!.text).toBe("Found via OpenAI search!");
  });

  it("works with claude provider", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("AI_PROVIDER", "claude");
    vi.stubEnv("AI_MODEL", "claude-sonnet-4-20250514");

    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Hello Claude",
      userId: 1,
      userName: "Alice",
    });

    const calls = mockFetchForAI("Hello from Claude!");

    await t.action(internal.telegram.processMessage, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      messageText: "Hello Claude",
      messageId: 1,
    });

    // Should have called Anthropic API
    const aiCalls = calls.filter((c) => c.url.includes("api.anthropic.com"));
    expect(aiCalls).toHaveLength(1);

    // Should have stored the response
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    expect(assistantMessages[0]!.text).toBe("Hello from Claude!");
  });
});

describe("processIssue", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test_token");
    vi.stubEnv("GITHUB_REPO", "owner/repo");
  });

  it("creates GitHub issue and replies with URL", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "The login page is broken",
      userId: 1,
      userName: "Alice",
    });

    const aiJson = JSON.stringify({
      title: "Bug: Login page broken",
      body: "## Description\nThe login page is broken.",
      relevant: true,
    });

    const calls = mockFetchForIssue(aiJson, {
      html_url: "https://github.com/owner/repo/issues/42",
      number: 42,
      title: "Bug: Login page broken",
    });

    await t.action(internal.telegram.processIssue, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      description: "fix the login page",
      messageId: 1,
    });

    // Should have called GitHub API
    const githubCalls = calls.filter((c) => c.url.includes("api.github.com"));
    expect(githubCalls).toHaveLength(1);
    expect((githubCalls[0]!.body as Record<string, unknown>).title).toBe(
      "Bug: Login page broken",
    );

    // Should have sent issue URL to user
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls).toHaveLength(1);
    expect((sendCalls[0]!.body as Record<string, unknown>).text).toContain(
      "https://github.com/owner/repo/issues/42",
    );
  });

  it("sends typing indicator first", async () => {
    const t = convexTest(schema, modules);
    const aiJson = JSON.stringify({
      title: "Bug",
      body: "Desc",
      relevant: true,
    });
    const calls = mockFetchForIssue(aiJson);

    await t.action(internal.telegram.processIssue, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      description: "some bug",
      messageId: 1,
    });

    const typingCalls = calls.filter((c) => c.url.includes("/sendChatAction"));
    expect(typingCalls).toHaveLength(1);
  });

  it("skips issue creation when AI returns relevant:false", async () => {
    const t = convexTest(schema, modules);
    const aiJson = JSON.stringify({
      title: "",
      body: "",
      relevant: false,
    });
    const calls = mockFetchForIssue(aiJson);

    await t.action(internal.telegram.processIssue, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      description: "",
      messageId: 1,
    });

    // Should NOT have called GitHub API
    const githubCalls = calls.filter((c) => c.url.includes("api.github.com"));
    expect(githubCalls).toHaveLength(0);

    // Should have sent skip message
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls).toHaveLength(1);
    expect((sendCalls[0]!.body as Record<string, unknown>).text).toContain(
      "Not enough context",
    );
  });

  it("sends error message when AI API fails", async () => {
    const t = convexTest(schema, modules);
    const calls = mockFetchForAIError("Internal Server Error");
    vi.stubEnv("GITHUB_TOKEN", "ghp_test_token");
    vi.stubEnv("GITHUB_REPO", "owner/repo");

    await t.action(internal.telegram.processIssue, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      description: "fix the bug",
      messageId: 1,
    });

    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);
    const errorMsg = sendCalls.find((c) =>
      ((c.body as Record<string, unknown>).text as string).includes("couldn't create"),
    );
    expect(errorMsg).toBeDefined();
  });

  it("includes messageThreadId for forum topics", async () => {
    const t = convexTest(schema, modules);
    const aiJson = JSON.stringify({
      title: "Bug",
      body: "Desc",
      relevant: true,
    });
    const calls = mockFetchForIssue(aiJson);

    await t.action(internal.telegram.processIssue, {
      chatId: 100,
      userId: 1,
      userName: "Alice",
      description: "bug in topic",
      messageId: 1,
      messageThreadId: 7,
    });

    const typingCall = calls.find((c) => c.url.includes("/sendChatAction"));
    expect((typingCall?.body as Record<string, unknown>).message_thread_id).toBe(7);

    const sendCall = calls.find((c) => c.url.includes("/sendMessage"));
    expect((sendCall?.body as Record<string, unknown>).message_thread_id).toBe(7);
  });
});
