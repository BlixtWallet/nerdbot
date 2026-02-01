import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { modules } from "./test.setup";

// --- Helpers ---

function makeUpdate(overrides: Record<string, unknown> = {}) {
  const base = {
    chat: { id: 100, type: "group", title: "Test Group" },
    from: { id: 1, first_name: "Alice" },
    text: "@nerdbot hello",
    message_id: 1,
  };
  return { message: { ...base, ...overrides } };
}

function webhookRequest(
  body: unknown,
  secret = "test-secret",
): { method: string; headers: Record<string, string>; body: string } {
  return {
    method: "POST",
    headers: {
      "x-telegram-bot-api-secret-token": secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

// Mock fetch to intercept Telegram API calls (sendMessage, sendChatAction)
function mockTelegramFetch() {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

// --- Setup ---

beforeEach(() => {
  // Use fake timers to prevent scheduled processMessage from executing.
  // The webhook handler calls ctx.scheduler.runAfter(0, ...) which we don't
  // want to fire during webhook-level tests.
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("BOT_USERNAME", "nerdbot");
  vi.stubEnv("ALLOWED_USER_IDS", "1,2,3");
  vi.stubEnv("ALLOWED_GROUP_IDS", "100,200");
  vi.stubEnv("RATE_LIMIT_PER_MINUTE", "10");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// --- Tests ---

describe("webhook: authentication", () => {
  it("returns 401 for invalid secret", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(makeUpdate(), "wrong-secret"),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 for valid secret", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    const response = await t.fetch("/api/telegram-webhook", webhookRequest(makeUpdate()));
    expect(response.status).toBe(200);
  });

  it("returns 400 for invalid JSON body", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/api/telegram-webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": "test-secret",
        "Content-Type": "application/json",
      },
      body: "not json{{{",
    });
    expect(response.status).toBe(400);
  });
});

describe("webhook: update filtering", () => {
  it("returns 200 and does nothing for updates without message", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/api/telegram-webhook", webhookRequest({}));
    expect(response.status).toBe(200);
  });

  it("returns 200 and does nothing for messages without text", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest({
        message: {
          chat: { id: 100, type: "group" },
          from: { id: 1, first_name: "Alice" },
          message_id: 1,
        },
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("webhook: allowlist enforcement", () => {
  it("blocks private chat from non-allowed user", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          chat: { id: 999, type: "private" },
          from: { id: 999, first_name: "Stranger" },
          text: "hello",
        }),
      ),
    );
    expect(response.status).toBe(200);
    // No messages should be stored
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 999,
    });
    expect(messages).toEqual([]);
  });

  it("allows private chat from allowed user", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          chat: { id: 1, type: "private" },
          from: { id: 1, first_name: "Alice" },
          text: "hello",
        }),
      ),
    );
    expect(response.status).toBe(200);
  });

  it("blocks group messages from non-allowed group", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          chat: { id: 999, type: "group" },
        }),
      ),
    );
    expect(response.status).toBe(200);
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 999,
    });
    expect(messages).toEqual([]);
  });
});

describe("webhook: message storage without response", () => {
  it("stores messages when bot should not respond", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "just chatting without mentioning the bot",
        }),
      ),
    );
    expect(response.status).toBe(200);
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("just chatting without mentioning the bot");
    expect(messages[0]!.role).toBe("user");
  });
});

describe("webhook: command handling", () => {
  it("handles /help command by sending help message", async () => {
    const t = convexTest(schema, modules);
    const calls = mockTelegramFetch();
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/help",
        }),
      ),
    );
    expect(response.status).toBe(200);
    // Should have called sendMessage via fetch
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);
    const helpCall = sendCalls[0];
    expect((helpCall!.body as Record<string, unknown>).text).toContain("AI assistant");
  });

  it("handles /start command like /help", async () => {
    const t = convexTest(schema, modules);
    const calls = mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/start",
        }),
      ),
    );
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("handles /reset command by clearing chat history", async () => {
    const t = convexTest(schema, modules);
    // Pre-populate some messages
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Old message",
    });

    const calls = mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/reset",
        }),
      ),
    );

    // Messages should be cleared
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toEqual([]);

    // Should confirm to user
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);
    expect((sendCalls[0]!.body as Record<string, unknown>).text).toContain("cleared");
  });
});

describe("webhook: /issue command", () => {
  it("schedules processIssue and returns 200", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/issue fix the login bug",
        }),
      ),
    );
    expect(response.status).toBe(200);
  });

  it("stores user message before scheduling", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/issue fix the login bug",
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("/issue fix the login bug");
    expect(messages[0]!.role).toBe("user");
  });

  it("handles /issue with no description", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/issue",
        }),
      ),
    );
    expect(response.status).toBe(200);

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("/issue");
  });

  it("handles /issue@nerdbot prefix", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/issue@nerdbot fix the bug",
        }),
      ),
    );
    expect(response.status).toBe(200);
  });

  it("blocks /issue from non-allowed issue user", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("ALLOWED_ISSUE_USER_IDS", "99,88");
    const calls = mockTelegramFetch();
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/issue fix the login bug",
        }),
      ),
    );
    expect(response.status).toBe(200);

    // Should have sent a permission denied message
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(sendCalls).toHaveLength(1);
    expect((sendCalls[0]!.body as Record<string, unknown>).text).toContain(
      "don't have permission",
    );

    // Should NOT store the message
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toEqual([]);
  });

  it("allows /issue from allowed issue user", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("ALLOWED_ISSUE_USER_IDS", "1,99");
    mockTelegramFetch();
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/issue fix the login bug",
        }),
      ),
    );
    expect(response.status).toBe(200);

    // Should store the message (issue was allowed)
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("/issue fix the login bug");
  });

  it("allows /issue from anyone when ALLOWED_ISSUE_USER_IDS is not set", async () => {
    const t = convexTest(schema, modules);
    // ALLOWED_ISSUE_USER_IDS is not set (default)
    mockTelegramFetch();
    const response = await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/issue fix the login bug",
        }),
      ),
    );
    expect(response.status).toBe(200);

    // Should store the message (no restriction)
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
  });

  it("includes /issue in help text", async () => {
    const t = convexTest(schema, modules);
    const calls = mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "/help",
        }),
      ),
    );
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    expect((sendCalls[0]!.body as Record<string, unknown>).text).toContain("/issue");
  });
});

describe("webhook: rate limiting", () => {
  it("blocks message when rate limit exceeded", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "2");
    const calls = mockTelegramFetch();

    // Send 2 messages to exhaust the limit
    for (let i = 0; i < 2; i++) {
      await t.fetch(
        "/api/telegram-webhook",
        webhookRequest(
          makeUpdate({
            text: `@nerdbot message ${i}`,
            message_id: i + 1,
          }),
        ),
      );
    }

    // Third message should be rate limited
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot one more",
          message_id: 100,
        }),
      ),
    );

    // Should have sent a "too fast" message
    const sendCalls = calls.filter((c) => c.url.includes("/sendMessage"));
    const rateLimitMsg = sendCalls.find((c) =>
      ((c.body as Record<string, unknown>).text as string).includes("too fast"),
    );
    expect(rateLimitMsg).toBeDefined();
  });
});

describe("webhook: message processing flow", () => {
  it("stores user message with mention stripped", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot what is the meaning of life?",
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("what is the meaning of life?");
  });

  it("creates chat record via ensureChat", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot hi",
        }),
      ),
    );

    const chat = await t.query(internal.messages.getChat, { chatId: 100 });
    expect(chat).toMatchObject({
      chatId: 100,
      chatTitle: "Test Group",
    });
  });

  it("preserves messageThreadId for forum topics", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot hello",
          message_thread_id: 42,
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
      messageThreadId: 42,
    });
    expect(messages).toHaveLength(1);
  });
});

describe("webhook: reply-to-message context", () => {
  it("prepends reply context when replying to a message with text", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot fact check",
          reply_to_message: {
            from: { id: 5, first_name: "Bob", is_bot: false },
            text: "BTC around $77,660 USD right now",
          },
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe(
      '[Replying to Bob: "BTC around $77,660 USD right now"]\nfact check',
    );
  });

  it("stores reply context even when bot does not respond", async () => {
    const t = convexTest(schema, modules);
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "that's interesting",
          reply_to_message: {
            from: { id: 5, first_name: "Bob", is_bot: false },
            text: "some earlier message",
          },
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe(
      '[Replying to Bob: "some earlier message"]\nthat\'s interesting',
    );
  });

  it("skips reply context when reply_to_message has no text", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot what is this?",
          reply_to_message: {
            from: { id: 5, first_name: "Bob", is_bot: false },
          },
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("what is this?");
  });

  it("uses Unknown when reply_to_message.from is undefined", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot explain",
          reply_to_message: {
            text: "some channel message",
          },
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe(
      '[Replying to Unknown: "some channel message"]\nexplain',
    );
  });

  it("includes last name in reply context when available", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot agreed",
          reply_to_message: {
            from: { id: 5, first_name: "Bob", last_name: "Smith", is_bot: false },
            text: "hot take here",
          },
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toContain('[Replying to Bob Smith: "hot take here"]');
  });

  it("handles reply to bot's own message", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "tell me more",
          reply_to_message: {
            from: { id: 999, first_name: "Nerdbot", is_bot: true },
            text: "BTC is a cryptocurrency...",
          },
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe(
      '[Replying to Nerdbot: "BTC is a cryptocurrency..."]\ntell me more',
    );
  });

  it("truncates very long replied-to text", async () => {
    const t = convexTest(schema, modules);
    mockTelegramFetch();
    const longText = "x".repeat(500);
    await t.fetch(
      "/api/telegram-webhook",
      webhookRequest(
        makeUpdate({
          text: "@nerdbot tldr",
          reply_to_message: {
            from: { id: 5, first_name: "Bob", is_bot: false },
            text: longText,
          },
        }),
      ),
    );

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toContain("x".repeat(200) + '..."');
    expect(messages[0]!.text).toContain("tldr");
  });
});
