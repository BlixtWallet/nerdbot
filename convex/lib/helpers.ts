export function shouldRespond(
  chatType: string,
  messageText: string,
  botUsername: string,
  isReplyToBot: boolean,
): boolean {
  const isPrivateChat = chatType === "private";
  const isMentioned = messageText.includes(`@${botUsername}`);
  const isCommand = messageText.startsWith("/");
  return isPrivateChat || isMentioned || isCommand || isReplyToBot;
}

export function isAllowedUser(userId: number, allowlist: string): boolean {
  if (!allowlist) return false;
  const ids = allowlist.split(",").map((id) => id.trim());
  return ids.includes(String(userId));
}

export function isAllowedChat(chatId: number, allowlist: string): boolean {
  if (!allowlist) return false;
  const ids = allowlist.split(",").map((id) => id.trim());
  return ids.includes(String(chatId));
}

export function parseCommand(messageText: string): string | undefined {
  return messageText.split(" ")[0]?.split("@")[0];
}

export function stripMention(text: string, botUsername: string): string {
  return text.replace(new RegExp(`@${botUsername}\\b`, "gi"), "").trim();
}

export function buildUserName(firstName: string, lastName?: string): string {
  return firstName + (lastName ? ` ${lastName}` : "");
}

export function formatReplyContext(
  replyUserName: string,
  replyText: string,
  maxQuoteLength = 200,
): string {
  const truncated =
    replyText.length > maxQuoteLength
      ? replyText.slice(0, maxQuoteLength) + "..."
      : replyText;
  return `[Replying to ${replyUserName}: "${truncated}"]\n`;
}

export function stripCitations(text: string): string {
  return text
    .replace(/\[\[\d+\]\]\([^)]*\)/g, "")
    .replace(/【[^】]*†[^】]*】/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function truncateResponse(text: string, maxLength = 4000): string {
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + "\n\n[truncated]";
  }
  return text;
}

export interface ConversationInput {
  role: string;
  userName?: string;
  text: string;
}

export function formatConversation(
  messages: ConversationInput[],
): { role: "user" | "assistant"; content: string | ContentPart[] }[] {
  return messages.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content:
      msg.role === "user" ? `[${msg.userName ?? "Unknown"}]: ${msg.text}` : msg.text,
  }));
}

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /xoxb-[a-zA-Z0-9-]+/,
  /ghp_[a-zA-Z0-9]{36,}/,
  /gho_[a-zA-Z0-9]{36,}/,
  /glpat-[a-zA-Z0-9_-]{20,}/,
  /Bearer\s+[a-zA-Z0-9._\-/+=]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}/,
];

const MAX_SYSTEM_PROMPT_LENGTH = 2000;

export function validateSystemPrompt(prompt: string): string | null {
  if (prompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    return `System prompt too long (${prompt.length} chars, max ${MAX_SYSTEM_PROMPT_LENGTH})`;
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(prompt)) {
      return "System prompt appears to contain a secret or API key";
    }
  }
  return null;
}

export function extractIssueDescription(messageText: string): string {
  const spaceIndex = messageText.indexOf(" ");
  if (spaceIndex === -1) return "";
  return messageText.slice(spaceIndex + 1).trim();
}

export interface IssueSummary {
  title: string;
  body: string;
  relevant: boolean;
}

export function parseIssueSummary(aiResponseText: string): IssueSummary {
  const cleaned = aiResponseText
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  if (
    typeof parsed.title !== "string" ||
    typeof parsed.body !== "string" ||
    typeof parsed.relevant !== "boolean"
  ) {
    throw new Error("Invalid issue summary format from AI");
  }

  return parsed as unknown as IssueSummary;
}

export interface RateLimitRecord {
  windowStart: number;
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  update: { windowStart: number; count: number } | null;
  insert: { windowStart: number; count: number } | null;
}

export function evaluateRateLimit(
  existing: RateLimitRecord | null,
  now: number,
  maxPerMinute: number,
  windowMs = 60_000,
): RateLimitResult {
  if (!existing) {
    return {
      allowed: true,
      update: null,
      insert: { windowStart: now, count: 1 },
    };
  }

  if (now - existing.windowStart > windowMs) {
    return {
      allowed: true,
      update: { windowStart: now, count: 1 },
      insert: null,
    };
  }

  if (existing.count >= maxPerMinute) {
    return { allowed: false, update: null, insert: null };
  }

  return {
    allowed: true,
    update: { windowStart: existing.windowStart, count: existing.count + 1 },
    insert: null,
  };
}
import type { ContentPart } from "./ai";
