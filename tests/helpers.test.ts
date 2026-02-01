import { test, expect, describe } from "bun:test";
import {
  shouldRespond,
  parseCommand,
  stripMention,
  buildUserName,
  truncateResponse,
  formatConversation,
  evaluateRateLimit,
} from "../convex/lib/helpers";

describe("shouldRespond", () => {
  test("always responds in private chat", () => {
    expect(shouldRespond("private", "hello", "nerdbot")).toBe(true);
  });

  test("responds to @mention in group", () => {
    expect(shouldRespond("group", "hey @nerdbot what's up", "nerdbot")).toBe(true);
  });

  test("responds to /command in group", () => {
    expect(shouldRespond("group", "/help", "nerdbot")).toBe(true);
  });

  test("does not respond to plain message in group", () => {
    expect(shouldRespond("group", "just chatting", "nerdbot")).toBe(false);
  });

  test("does not respond to plain message in supergroup", () => {
    expect(shouldRespond("supergroup", "hey everyone", "nerdbot")).toBe(false);
  });

  test("responds to mention in supergroup", () => {
    expect(shouldRespond("supergroup", "@nerdbot help me", "nerdbot")).toBe(true);
  });

  test("does not respond when different bot is mentioned", () => {
    expect(shouldRespond("group", "hey @otherbot", "nerdbot")).toBe(false);
  });

  test("responds to mention anywhere in text", () => {
    expect(shouldRespond("group", "what do you think @nerdbot?", "nerdbot")).toBe(true);
  });

  test("does not treat reply-to-bot as trigger", () => {
    expect(shouldRespond("group", "I agree with that", "nerdbot")).toBe(false);
  });
});

describe("parseCommand", () => {
  test("parses simple command", () => {
    expect(parseCommand("/help")).toBe("/help");
  });

  test("parses command with arguments", () => {
    expect(parseCommand("/reset all")).toBe("/reset");
  });

  test("strips @botname from command", () => {
    expect(parseCommand("/help@nerdbot")).toBe("/help");
  });

  test("strips @botname and keeps args separate", () => {
    expect(parseCommand("/reset@nerdbot now")).toBe("/reset");
  });

  test("returns undefined for empty string", () => {
    expect(parseCommand("")).toBe("");
  });
});

describe("stripMention", () => {
  test("strips mention from start", () => {
    expect(stripMention("@nerdbot hello", "nerdbot")).toBe("hello");
  });

  test("strips mention from middle", () => {
    expect(stripMention("hey @nerdbot what's up", "nerdbot")).toBe("hey  what's up");
  });

  test("strips mention from end", () => {
    expect(stripMention("what do you think @nerdbot", "nerdbot")).toBe(
      "what do you think",
    );
  });

  test("strips multiple mentions", () => {
    expect(stripMention("@nerdbot hey @nerdbot", "nerdbot")).toBe("hey");
  });

  test("is case insensitive", () => {
    expect(stripMention("@NerdBot hello", "nerdbot")).toBe("hello");
  });

  test("does not strip partial matches", () => {
    expect(stripMention("@nerdbotextended hello", "nerdbot")).toBe(
      "@nerdbotextended hello",
    );
  });

  test("returns original text if no mention", () => {
    expect(stripMention("just a message", "nerdbot")).toBe("just a message");
  });
});

describe("buildUserName", () => {
  test("returns first name only", () => {
    expect(buildUserName("John")).toBe("John");
  });

  test("combines first and last name", () => {
    expect(buildUserName("John", "Doe")).toBe("John Doe");
  });

  test("handles undefined last name", () => {
    expect(buildUserName("Jane", undefined)).toBe("Jane");
  });
});

describe("truncateResponse", () => {
  test("returns short text unchanged", () => {
    expect(truncateResponse("hello")).toBe("hello");
  });

  test("returns text at exact limit unchanged", () => {
    const text = "a".repeat(4000);
    expect(truncateResponse(text)).toBe(text);
  });

  test("truncates text over limit", () => {
    const text = "a".repeat(4001);
    const result = truncateResponse(text);
    expect(result).toHaveLength(4000 + "\n\n[truncated]".length);
    expect(result.endsWith("\n\n[truncated]")).toBe(true);
  });

  test("accepts custom max length", () => {
    const result = truncateResponse("hello world", 5);
    expect(result).toBe("hello\n\n[truncated]");
  });

  test("returns empty string unchanged", () => {
    expect(truncateResponse("")).toBe("");
  });
});

describe("formatConversation", () => {
  test("formats user message with username", () => {
    const result = formatConversation([
      { role: "user", userName: "Alice", text: "hello" },
    ]);
    expect(result).toEqual([{ role: "user", content: "[Alice]: hello" }]);
  });

  test("uses Unknown when userName is missing", () => {
    const result = formatConversation([{ role: "user", text: "hello" }]);
    expect(result).toEqual([{ role: "user", content: "[Unknown]: hello" }]);
  });

  test("formats assistant message without prefix", () => {
    const result = formatConversation([{ role: "assistant", text: "Hi there!" }]);
    expect(result).toEqual([{ role: "assistant", content: "Hi there!" }]);
  });

  test("formats mixed conversation", () => {
    const result = formatConversation([
      { role: "user", userName: "Bob", text: "What is 2+2?" },
      { role: "assistant", text: "4" },
      { role: "user", userName: "Alice", text: "Thanks" },
    ]);
    expect(result).toEqual([
      { role: "user", content: "[Bob]: What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "[Alice]: Thanks" },
    ]);
  });

  test("handles empty array", () => {
    expect(formatConversation([])).toEqual([]);
  });
});

describe("evaluateRateLimit", () => {
  const now = 1000000;

  test("allows first request (no existing record)", () => {
    const result = evaluateRateLimit(null, now, 10);
    expect(result.allowed).toBe(true);
    expect(result.insert).toEqual({ windowStart: now, count: 1 });
    expect(result.update).toBeNull();
  });

  test("allows second request within window", () => {
    const result = evaluateRateLimit({ windowStart: now - 5000, count: 1 }, now, 10);
    expect(result.allowed).toBe(true);
    expect(result.update).toEqual({ windowStart: now - 5000, count: 2 });
    expect(result.insert).toBeNull();
  });

  test("allows request up to max per minute", () => {
    const result = evaluateRateLimit({ windowStart: now - 5000, count: 9 }, now, 10);
    expect(result.allowed).toBe(true);
    expect(result.update).toEqual({ windowStart: now - 5000, count: 10 });
  });

  test("blocks request at max per minute", () => {
    const result = evaluateRateLimit({ windowStart: now - 5000, count: 10 }, now, 10);
    expect(result.allowed).toBe(false);
    expect(result.update).toBeNull();
    expect(result.insert).toBeNull();
  });

  test("blocks request over max per minute", () => {
    const result = evaluateRateLimit({ windowStart: now - 5000, count: 15 }, now, 10);
    expect(result.allowed).toBe(false);
  });

  test("resets window after expiry", () => {
    const result = evaluateRateLimit({ windowStart: now - 61_000, count: 10 }, now, 10);
    expect(result.allowed).toBe(true);
    expect(result.update).toEqual({ windowStart: now, count: 1 });
    expect(result.insert).toBeNull();
  });

  test("resets window at exact boundary", () => {
    // At exactly 60001ms, window has expired
    const result = evaluateRateLimit({ windowStart: now - 60_001, count: 10 }, now, 10);
    expect(result.allowed).toBe(true);
  });

  test("does not reset window at exact 60s", () => {
    // At exactly 60000ms, window has NOT expired (not > windowMs)
    const result = evaluateRateLimit({ windowStart: now - 60_000, count: 10 }, now, 10);
    expect(result.allowed).toBe(false);
  });

  test("respects custom maxPerMinute", () => {
    const result = evaluateRateLimit({ windowStart: now - 5000, count: 3 }, now, 3);
    expect(result.allowed).toBe(false);
  });

  test("allows with custom low maxPerMinute when under limit", () => {
    const result = evaluateRateLimit({ windowStart: now - 5000, count: 2 }, now, 3);
    expect(result.allowed).toBe(true);
    expect(result.update).toEqual({ windowStart: now - 5000, count: 3 });
  });

  test("respects custom window size", () => {
    // 30s window, record is 31s old — should reset
    const result = evaluateRateLimit(
      { windowStart: now - 31_000, count: 10 },
      now,
      10,
      30_000,
    );
    expect(result.allowed).toBe(true);
    expect(result.update).toEqual({ windowStart: now, count: 1 });
  });
});
