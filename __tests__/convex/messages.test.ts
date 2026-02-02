import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { modules } from "./test.setup";

describe("messages.store", () => {
  it("inserts a user message and returns the id", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Hello",
      userId: 1,
      userName: "Alice",
    });
    expect(id).toBeDefined();

    const msg = await t.run(async (ctx) => {
      return await ctx.db.get("messages", id);
    });
    expect(msg).toMatchObject({
      chatId: 100,
      role: "user",
      text: "Hello",
      userId: 1,
      userName: "Alice",
    });
    expect(msg?.timestamp).toBeTypeOf("number");
  });

  it("inserts an assistant message without userId", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "assistant",
      text: "Hi there",
    });
    const msg = await t.run(async (ctx) => {
      return await ctx.db.get("messages", id);
    });
    expect(msg).toMatchObject({
      chatId: 100,
      role: "assistant",
      text: "Hi there",
    });
    expect(msg?.userId).toBeUndefined();
  });

  it("stores messageThreadId when provided", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 42,
      role: "user",
      text: "Thread message",
    });
    const msg = await t.run(async (ctx) => {
      return await ctx.db.get("messages", id);
    });
    expect(msg?.messageThreadId).toBe(42);
  });
});

describe("messages.getRecent", () => {
  it("returns empty array when no messages exist", async () => {
    const t = convexTest(schema, modules);
    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toEqual([]);
  });

  it("returns messages in chronological order", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "First",
    });
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "assistant",
      text: "Second",
    });
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Third",
    });

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(3);
    expect(messages[0]!.text).toBe("First");
    expect(messages[1]!.text).toBe("Second");
    expect(messages[2]!.text).toBe("Third");
  });

  it("respects the limit parameter", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i++) {
      await t.mutation(internal.messages.store, {
        chatId: 100,
        role: "user",
        text: `Message ${i}`,
      });
    }

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
      limit: 2,
    });
    expect(messages).toHaveLength(2);
    // Should return the most recent 2, in chronological order
    expect(messages[0]!.text).toBe("Message 3");
    expect(messages[1]!.text).toBe("Message 4");
  });

  it("defaults limit to 30", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 35; i++) {
      await t.mutation(internal.messages.store, {
        chatId: 100,
        role: "user",
        text: `Message ${i}`,
      });
    }

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(30);
  });

  it("filters by chatId", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Chat 100",
    });
    await t.mutation(internal.messages.store, {
      chatId: 200,
      role: "user",
      text: "Chat 200",
    });

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("Chat 100");
  });

  it("filters by messageThreadId", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 1,
      role: "user",
      text: "Thread 1",
    });
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 2,
      role: "user",
      text: "Thread 2",
    });

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
      messageThreadId: 1,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("Thread 1");
  });
});

describe("messages.getRecentImageForUser", () => {
  it("returns the most recent image message for the user within the time window", async () => {
    const t = convexTest(schema, modules);
    const now = 1_000_000;
    const dateSpy = vi.spyOn(Date, "now");

    dateSpy.mockReturnValue(now - 600_000);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 1,
      role: "user",
      text: "[Image] old",
      userId: 1,
      imageFileId: "old-file",
    });

    dateSpy.mockReturnValue(now - 1_000);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 1,
      role: "user",
      text: "[Image] new",
      userId: 1,
      imageFileId: "new-file",
      imageMimeType: "image/png",
      imageFileSize: 1234,
    });

    dateSpy.mockReturnValue(now - 500);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 1,
      role: "user",
      text: "no image",
      userId: 1,
    });

    dateSpy.mockRestore();

    const result = await t.query(internal.messages.getRecentImageForUser, {
      chatId: 100,
      messageThreadId: 1,
      userId: 1,
      since: now - 300_000,
    });

    expect(result?.imageFileId).toBe("new-file");
    expect(result?.imageMimeType).toBe("image/png");
  });

  it("returns null when no recent image exists", async () => {
    const t = convexTest(schema, modules);
    const now = 2_000_000;
    const dateSpy = vi.spyOn(Date, "now");
    dateSpy.mockReturnValue(now - 600_000);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 1,
      role: "user",
      text: "[Image] old",
      userId: 1,
      imageFileId: "old-file",
    });
    dateSpy.mockRestore();

    const result = await t.query(internal.messages.getRecentImageForUser, {
      chatId: 100,
      messageThreadId: 1,
      userId: 1,
      since: now - 60_000,
    });

    expect(result).toBeNull();
  });
});

describe("messages.ensureChat", () => {
  it("creates a new chat record", async () => {
    const t = convexTest(schema, modules);
    const chat = await t.mutation(internal.messages.ensureChat, {
      chatId: 100,
      chatTitle: "Test Group",
    });
    expect(chat).toMatchObject({
      chatId: 100,
      chatTitle: "Test Group",
      enabled: true,
    });
    expect(chat?.createdAt).toBeTypeOf("number");
  });

  it("returns existing chat without modifying it", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.messages.ensureChat, {
      chatId: 100,
      chatTitle: "Test Group",
    });
    const second = await t.mutation(internal.messages.ensureChat, {
      chatId: 100,
      chatTitle: "Test Group",
    });
    expect(second?._id).toEqual(first?._id);
    expect(second?.chatTitle).toBe("Test Group");
  });

  it("updates chatTitle when it changes", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.ensureChat, {
      chatId: 100,
      chatTitle: "Old Title",
    });
    const updated = await t.mutation(internal.messages.ensureChat, {
      chatId: 100,
      chatTitle: "New Title",
    });
    expect(updated?.chatTitle).toBe("Old Title"); // Returns the existing record before patch
    // Verify DB was actually updated
    const fromDb = await t.query(internal.messages.getChat, { chatId: 100 });
    expect(fromDb?.chatTitle).toBe("New Title");
  });

  it("does not update when chatTitle is undefined", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.ensureChat, {
      chatId: 100,
      chatTitle: "Original",
    });
    await t.mutation(internal.messages.ensureChat, {
      chatId: 100,
    });
    const fromDb = await t.query(internal.messages.getChat, { chatId: 100 });
    expect(fromDb?.chatTitle).toBe("Original");
  });
});

describe("messages.getChat", () => {
  it("returns null when chat does not exist", async () => {
    const t = convexTest(schema, modules);
    const chat = await t.query(internal.messages.getChat, { chatId: 999 });
    expect(chat).toBeNull();
  });

  it("returns the chat record when it exists", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.ensureChat, {
      chatId: 100,
      chatTitle: "My Chat",
    });
    const chat = await t.query(internal.messages.getChat, { chatId: 100 });
    expect(chat).toMatchObject({
      chatId: 100,
      chatTitle: "My Chat",
      enabled: true,
    });
  });
});

describe("messages.checkRateLimit", () => {
  it("allows the first request", async () => {
    const t = convexTest(schema, modules);
    const allowed = await t.mutation(internal.messages.checkRateLimit, {
      chatId: 100,
      userId: 1,
    });
    expect(allowed).toBe(true);
  });

  it("allows requests within the limit", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 9; i++) {
      await t.mutation(internal.messages.checkRateLimit, {
        chatId: 100,
        userId: 1,
        maxPerMinute: 10,
      });
    }
    const allowed = await t.mutation(internal.messages.checkRateLimit, {
      chatId: 100,
      userId: 1,
      maxPerMinute: 10,
    });
    expect(allowed).toBe(true);
  });

  it("blocks when rate limit is exceeded", async () => {
    const t = convexTest(schema, modules);
    // Use up the limit
    for (let i = 0; i < 10; i++) {
      await t.mutation(internal.messages.checkRateLimit, {
        chatId: 100,
        userId: 1,
        maxPerMinute: 10,
      });
    }
    const allowed = await t.mutation(internal.messages.checkRateLimit, {
      chatId: 100,
      userId: 1,
      maxPerMinute: 10,
    });
    expect(allowed).toBe(false);
  });

  it("rate limits are per-user", async () => {
    const t = convexTest(schema, modules);
    // Exhaust limit for user 1
    for (let i = 0; i < 10; i++) {
      await t.mutation(internal.messages.checkRateLimit, {
        chatId: 100,
        userId: 1,
        maxPerMinute: 10,
      });
    }
    // User 2 should still be allowed
    const allowed = await t.mutation(internal.messages.checkRateLimit, {
      chatId: 100,
      userId: 2,
      maxPerMinute: 10,
    });
    expect(allowed).toBe(true);
  });

  it("rate limits are per-chat", async () => {
    const t = convexTest(schema, modules);
    // Exhaust limit in chat 100
    for (let i = 0; i < 10; i++) {
      await t.mutation(internal.messages.checkRateLimit, {
        chatId: 100,
        userId: 1,
        maxPerMinute: 10,
      });
    }
    // Same user in chat 200 should be allowed
    const allowed = await t.mutation(internal.messages.checkRateLimit, {
      chatId: 200,
      userId: 1,
      maxPerMinute: 10,
    });
    expect(allowed).toBe(true);
  });

  it("respects custom maxPerMinute", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.checkRateLimit, {
      chatId: 100,
      userId: 1,
      maxPerMinute: 1,
    });
    const allowed = await t.mutation(internal.messages.checkRateLimit, {
      chatId: 100,
      userId: 1,
      maxPerMinute: 1,
    });
    expect(allowed).toBe(false);
  });
});

describe("messages.clearChat", () => {
  it("deletes all messages for a chat", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Message 1",
    });
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "assistant",
      text: "Message 2",
    });

    await t.mutation(internal.messages.clearChat, { chatId: 100 });

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toEqual([]);
  });

  it("only deletes messages for the specified chat", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      role: "user",
      text: "Chat 100",
    });
    await t.mutation(internal.messages.store, {
      chatId: 200,
      role: "user",
      text: "Chat 200",
    });

    await t.mutation(internal.messages.clearChat, { chatId: 100 });

    const chat100 = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    const chat200 = await t.query(internal.messages.getRecent, {
      chatId: 200,
    });
    expect(chat100).toEqual([]);
    expect(chat200).toHaveLength(1);
  });

  it("filters by messageThreadId", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 1,
      role: "user",
      text: "Thread 1",
    });
    await t.mutation(internal.messages.store, {
      chatId: 100,
      messageThreadId: 2,
      role: "user",
      text: "Thread 2",
    });

    await t.mutation(internal.messages.clearChat, {
      chatId: 100,
      messageThreadId: 1,
    });

    const thread1 = await t.query(internal.messages.getRecent, {
      chatId: 100,
      messageThreadId: 1,
    });
    const thread2 = await t.query(internal.messages.getRecent, {
      chatId: 100,
      messageThreadId: 2,
    });
    expect(thread1).toEqual([]);
    expect(thread2).toHaveLength(1);
  });
});

describe("messages.deleteOldMessages", () => {
  it("does nothing when messages are within retention limit", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("MAX_RETAINED_MESSAGES", "5");

    for (let i = 0; i < 5; i++) {
      await t.mutation(internal.messages.store, {
        chatId: 100,
        role: "user",
        text: `Message ${i}`,
      });
    }

    await t.mutation(internal.messages.deleteOldMessages, {});

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(5);

    vi.unstubAllEnvs();
  });

  it("deletes messages exceeding retention limit", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("MAX_RETAINED_MESSAGES", "3");

    // Insert with explicit timestamps so sort order is deterministic
    for (let i = 0; i < 5; i++) {
      await t.run(async (ctx) => {
        await ctx.db.insert("messages", {
          chatId: 100,
          role: "user",
          text: `Message ${i}`,
          timestamp: 1000 + i,
        });
      });
    }

    await t.mutation(internal.messages.deleteOldMessages, {});

    const messages = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    expect(messages).toHaveLength(3);
    // Should keep the most recent 3
    expect(messages[0]!.text).toBe("Message 2");
    expect(messages[1]!.text).toBe("Message 3");
    expect(messages[2]!.text).toBe("Message 4");

    vi.unstubAllEnvs();
  });

  it("handles multiple chat groups independently", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("MAX_RETAINED_MESSAGES", "2");

    for (let i = 0; i < 4; i++) {
      await t.mutation(internal.messages.store, {
        chatId: 100,
        role: "user",
        text: `Chat100 ${i}`,
      });
    }
    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.messages.store, {
        chatId: 200,
        role: "user",
        text: `Chat200 ${i}`,
      });
    }

    await t.mutation(internal.messages.deleteOldMessages, {});

    const chat100 = await t.query(internal.messages.getRecent, {
      chatId: 100,
    });
    const chat200 = await t.query(internal.messages.getRecent, {
      chatId: 200,
    });
    expect(chat100).toHaveLength(2);
    expect(chat200).toHaveLength(2);

    vi.unstubAllEnvs();
  });
});
