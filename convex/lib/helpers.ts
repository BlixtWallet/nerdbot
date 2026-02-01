export function shouldRespond(
  chatType: string,
  messageText: string,
  botUsername: string,
): boolean {
  const isPrivateChat = chatType === "private";
  const isMentioned = messageText.includes(`@${botUsername}`);
  const isCommand = messageText.startsWith("/");
  return isPrivateChat || isMentioned || isCommand;
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
): { role: "user" | "assistant"; content: string }[] {
  return messages.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content:
      msg.role === "user" ? `[${msg.userName ?? "Unknown"}]: ${msg.text}` : msg.text,
  }));
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
