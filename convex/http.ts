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
  extractIssueDescription,
} from "./lib/helpers";
import { createLogger } from "./lib/logger";

interface TelegramUpdate {
  message?: {
    chat: { id: number; type: string; title?: string };
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      is_bot?: boolean;
    };
    text?: string;
    caption?: string;
    message_id: number;
    message_thread_id?: number;
    photo?: {
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }[];
    document?: {
      file_id: string;
      file_unique_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    reply_to_message?: {
      from?: {
        id: number;
        first_name: string;
        last_name?: string;
        username?: string;
        is_bot?: boolean;
      };
      text?: string;
    };
  };
}

const http = httpRouter();

const IMAGE_QUESTION_PROMPT =
  "What should I look for in this image? Add a question in the caption or reply with a question.";
const RECENT_IMAGE_LOOKBACK_MS = 10 * 60 * 1000;

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
    const hasText = Boolean(message?.text ?? message?.caption);
    const hasPhoto = Boolean(message?.photo && message.photo.length > 0);
    const hasImageDoc = Boolean(message?.document?.mime_type?.startsWith("image/"));
    if (!message || (!hasText && !hasPhoto && !hasImageDoc)) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const userName = buildUserName(message.from.first_name, message.from.last_name);
    const messageText = message.text ?? message.caption ?? "";
    const messageId = message.message_id;
    const chatTitle = message.chat.title;
    const messageThreadId = message.message_thread_id;
    const botUsername = process.env.BOT_USERNAME ?? "";
    const token = requireEnv("TELEGRAM_BOT_TOKEN");

    const photo = message.photo?.[message.photo.length - 1];
    let image: { fileId: string; mimeType?: string; fileSize?: number } | undefined;
    if (photo?.file_id) {
      image = {
        fileId: photo.file_id,
        mimeType: "image/jpeg",
        fileSize: photo.file_size,
      };
    } else if (
      message.document?.mime_type?.startsWith("image/") &&
      message.document.file_id
    ) {
      image = {
        fileId: message.document.file_id,
        mimeType: message.document.mime_type,
        fileSize: message.document.file_size,
      };
    }

    const imageFields = image
      ? {
          imageFileId: image.fileId,
          imageMimeType: image.mimeType,
          imageFileSize: image.fileSize,
        }
      : {};

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

    const cleanText = stripMention(messageText, botUsername);
    const storedText = image
      ? `${replyContext}[Image]${cleanText ? ` ${cleanText}` : ""}`
      : replyContext + cleanText;

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
    const replyUsername = message.reply_to_message?.from?.username;
    const isReplyToBot =
      message.reply_to_message?.from?.is_bot === true &&
      Boolean(replyUsername) &&
      replyUsername?.toLowerCase() === botUsername.toLowerCase();
    const isReplyToImagePrompt =
      isReplyToBot && message.reply_to_message?.text?.trim() === IMAGE_QUESTION_PROMPT;
    if (!shouldRespond(message.chat.type, messageText, botUsername, isReplyToBot)) {
      // Store message for context but don't respond
      await ctx.runMutation(internal.messages.store, {
        chatId,
        messageThreadId,
        userId,
        userName,
        role: "user" as const,
        text: storedText,
        ...imageFields,
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
            "/reset — Clear conversation history\n" +
            "/issue <desc> — Create a GitHub issue from conversation",
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

      if (command === "/issue") {
        const issueAllowlist = process.env.ALLOWED_ISSUE_USER_IDS ?? "";
        if (issueAllowlist && !isAllowedUser(userId, issueAllowlist)) {
          await sendMessage(
            token,
            chatId,
            "You don't have permission to create issues.",
            { replyToMessageId: messageId, messageThreadId },
          );
          log.set("blocked", true).set("reason", "issue_user_not_allowed").warn();
          return new Response("OK", { status: 200 });
        }

        const description = extractIssueDescription(messageText);

        await ctx.runMutation(internal.messages.store, {
          chatId,
          messageThreadId,
          userId,
          userName,
          role: "user" as const,
          text: storedText,
          ...imageFields,
          telegramMessageId: messageId,
        });

        await ctx.scheduler.runAfter(0, internal.telegram.processIssue, {
          chatId,
          userId,
          userName,
          description,
          messageId,
          messageThreadId,
        });

        log.set("action", "issue_scheduled").info();
        return new Response("OK", { status: 200 });
      }

      // Unrecognized command — store for context but don't trigger AI
      await ctx.runMutation(internal.messages.store, {
        chatId,
        messageThreadId,
        userId,
        userName,
        role: "user" as const,
        text: storedText,
        ...imageFields,
        telegramMessageId: messageId,
      });
      return new Response("OK", { status: 200 });
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

    if (image && !cleanText) {
      await ctx.runMutation(internal.messages.store, {
        chatId,
        messageThreadId,
        userId,
        userName,
        role: "user" as const,
        text: storedText,
        ...imageFields,
        telegramMessageId: messageId,
      });

      await sendMessage(token, chatId, IMAGE_QUESTION_PROMPT, {
        replyToMessageId: messageId,
        messageThreadId,
      });
      return new Response("OK", { status: 200 });
    }

    // 6. Store user message (strip @mention, prepend reply context)
    const cleanTextWithContext = storedText;
    await ctx.runMutation(internal.messages.store, {
      chatId,
      messageThreadId,
      userId,
      userName,
      role: "user" as const,
      text: cleanTextWithContext,
      ...imageFields,
      telegramMessageId: messageId,
    });

    await ctx.runMutation(internal.messages.ensureChat, {
      chatId,
      chatTitle,
    });

    let imageForRequest = image;
    if (!imageForRequest && isReplyToImagePrompt) {
      const recentImage = await ctx.runQuery(internal.messages.getRecentImageForUser, {
        chatId,
        messageThreadId,
        userId,
        since: Date.now() - RECENT_IMAGE_LOOKBACK_MS,
      });
      if (recentImage?.imageFileId) {
        imageForRequest = {
          fileId: recentImage.imageFileId,
          mimeType: recentImage.imageMimeType,
          fileSize: recentImage.imageFileSize,
        };
      }
    }

    // 7. Schedule AI processing (async)
    const scheduleArgs: {
      chatId: number;
      userId: number;
      userName: string;
      messageText: string;
      messageId: number;
      messageThreadId?: number;
      image?: { fileId: string; mimeType?: string; fileSize?: number };
    } = {
      chatId,
      userId,
      userName,
      messageText: cleanText,
      messageId,
      messageThreadId,
      ...(imageForRequest ? { image: imageForRequest } : {}),
    };

    await ctx.scheduler.runAfter(0, internal.telegram.processMessage, scheduleArgs);

    log.set("action", "scheduled").info();
    return new Response("OK", { status: 200 });
  }),
});

export default http;
