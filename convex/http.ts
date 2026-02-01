import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendMessage } from "./lib/telegramApi";
import { requireEnv } from "./lib/env";
import {
  shouldRespond,
  isAllowedUser,
  isAllowedChat,
  parseCommand,
  stripMention,
  buildUserName,
  formatReplyContext,
} from "./lib/helpers";
import { createLogger } from "./lib/logger";

interface TelegramUpdate {
  message?: {
    chat: { id: number; type: string; title?: string };
    from: { id: number; first_name: string; last_name?: string };
    text?: string;
    message_id: number;
    message_thread_id?: number;
    reply_to_message?: {
      from?: { id: number; first_name: string; last_name?: string; is_bot?: boolean };
      text?: string;
    };
  };
}

const http = httpRouter();

http.route({
  path: "/api/telegram-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // 1. Validate the webhook secret
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");

    if (secret && headerSecret !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. Parse the Telegram update
    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const message = update.message;
    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const userName = buildUserName(message.from.first_name, message.from.last_name);
    const messageText = message.text;
    const messageId = message.message_id;
    const chatTitle = message.chat.title;
    const messageThreadId = message.message_thread_id;
    const botUsername = process.env.BOT_USERNAME ?? "";
    const token = requireEnv("TELEGRAM_BOT_TOKEN");

    // Compute reply context once (used in both storage paths)
    const replyMsg = message.reply_to_message;
    const replyContext = replyMsg?.text
      ? formatReplyContext(
          replyMsg.from
            ? buildUserName(replyMsg.from.first_name, replyMsg.from.last_name)
            : "Unknown",
          replyMsg.text,
        )
      : "";

    const log = createLogger("webhook")
      .set("chatId", chatId)
      .set("userId", userId)
      .set("userName", userName)
      .set("chatType", message.chat.type);

    // 3. Check allowlists
    // In private chats: user must be in ALLOWED_USER_IDS
    // In groups: group must be in ALLOWED_GROUP_IDS (all members can interact)
    const isPrivate = message.chat.type === "private";
    if (isPrivate && !isAllowedUser(userId, process.env.ALLOWED_USER_IDS ?? "")) {
      log.set("blocked", true).set("reason", "user_not_allowed").warn();
      return new Response("OK", { status: 200 });
    }
    if (!isPrivate && !isAllowedChat(chatId, process.env.ALLOWED_GROUP_IDS ?? "")) {
      log
        .set("blocked", true)
        .set("reason", "group_not_allowed")
        .set("chatTitle", chatTitle ?? null)
        .warn();
      return new Response("OK", { status: 200 });
    }

    // 4. Determine if the bot should respond
    const isReplyToBot = message.reply_to_message?.from?.is_bot === true;
    if (!shouldRespond(message.chat.type, messageText, botUsername, isReplyToBot)) {
      // Store message for context but don't respond
      await ctx.runMutation(internal.messages.store, {
        chatId,
        messageThreadId,
        userId,
        userName,
        role: "user" as const,
        text: replyContext + messageText,
        telegramMessageId: messageId,
      });
      return new Response("OK", { status: 200 });
    }

    // 4. Handle commands
    if (messageText.startsWith("/")) {
      const command = parseCommand(messageText);

      if (command === "/start" || command === "/help") {
        await sendMessage(
          token,
          chatId,
          `Hi! I'm an AI assistant. Mention me with @${botUsername} to chat.\n\n` +
            "Commands:\n" +
            "/help — Show this message\n" +
            "/reset — Clear conversation history",
          { messageThreadId },
        );
        return new Response("OK", { status: 200 });
      }

      if (command === "/reset") {
        await ctx.runMutation(internal.messages.clearChat, { chatId, messageThreadId });
        await sendMessage(token, chatId, "Conversation history cleared.", {
          messageThreadId,
        });
        return new Response("OK", { status: 200 });
      }
    }

    // 5. Rate limit check
    const allowed = await ctx.runMutation(internal.messages.checkRateLimit, {
      chatId,
      userId,
      maxPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? "10"),
    });

    if (!allowed) {
      await sendMessage(
        token,
        chatId,
        "You're sending messages too fast. Please wait a moment.",
        { replyToMessageId: messageId, messageThreadId },
      );
      return new Response("OK", { status: 200 });
    }

    // 6. Store user message (strip @mention, prepend reply context)
    const cleanText = replyContext + stripMention(messageText, botUsername);

    await ctx.runMutation(internal.messages.store, {
      chatId,
      messageThreadId,
      userId,
      userName,
      role: "user" as const,
      text: cleanText,
      telegramMessageId: messageId,
    });

    await ctx.runMutation(internal.messages.ensureChat, {
      chatId,
      chatTitle,
    });

    // 7. Schedule AI processing (async)
    await ctx.scheduler.runAfter(0, internal.telegram.processMessage, {
      chatId,
      userId,
      userName,
      messageText: cleanText,
      messageId,
      messageThreadId,
    });

    log.set("action", "scheduled").info();
    return new Response("OK", { status: 200 });
  }),
});

export default http;
