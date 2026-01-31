import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendMessage } from "./lib/telegramApi";
import { requireEnv } from "./lib/env";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let update: any;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const message = update.message;
    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId: number = message.chat.id;
    const userId: number = message.from.id;
    const userName: string =
      String(message.from.first_name) +
      (message.from.last_name ? ` ${String(message.from.last_name)}` : "");
    const messageText: string = message.text;
    const messageId: number = message.message_id;
    const chatTitle: string | undefined = message.chat.title;
    const botUsername = process.env.BOT_USERNAME ?? "";
    const token = requireEnv("TELEGRAM_BOT_TOKEN");

    // 3. Determine if the bot should respond
    const isPrivateChat = message.chat.type === "private";
    const isMentioned = messageText.includes(`@${botUsername}`);
    const isReplyToBot = message.reply_to_message?.from?.username === botUsername;
    const isCommand = messageText.startsWith("/");

    const shouldRespond = isPrivateChat || isMentioned || isReplyToBot || isCommand;

    if (!shouldRespond) {
      // Store message for context but don't respond
      await ctx.runMutation(internal.messages.store, {
        chatId,
        userId,
        userName,
        role: "user" as const,
        text: messageText,
        telegramMessageId: messageId,
      });
      return new Response("OK", { status: 200 });
    }

    // 4. Handle commands
    if (isCommand) {
      const command = messageText.split(" ")[0].split("@")[0];

      if (command === "/start" || command === "/help") {
        await sendMessage(
          token,
          chatId,
          `Hi! I'm an AI assistant. Mention me with @${botUsername} or reply to my messages to chat.\n\n` +
            "Commands:\n" +
            "/help — Show this message\n" +
            "/reset — Clear conversation history\n" +
            "/setprompt — Set a custom system prompt",
        );
        return new Response("OK", { status: 200 });
      }

      if (command === "/reset") {
        await ctx.runMutation(internal.messages.clearChat, { chatId });
        await sendMessage(token, chatId, "Conversation history cleared.");
        return new Response("OK", { status: 200 });
      }

      if (command === "/setprompt") {
        const newPrompt = messageText.replace(/^\/setprompt(@\w+)?\s*/, "");
        if (!newPrompt) {
          await sendMessage(token, chatId, "Usage: /setprompt Your custom prompt here");
          return new Response("OK", { status: 200 });
        }
        await ctx.runMutation(internal.messages.ensureChat, {
          chatId,
          chatTitle,
        });
        await ctx.runMutation(internal.messages.updateSystemPrompt, {
          chatId,
          systemPrompt: newPrompt,
        });
        await sendMessage(token, chatId, "System prompt updated.");
        return new Response("OK", { status: 200 });
      }
    }

    // 5. Rate limit check
    const allowed = await ctx.runMutation(internal.messages.checkRateLimit, {
      chatId,
      userId,
      maxPerMinute: 10,
    });

    if (!allowed) {
      await sendMessage(
        token,
        chatId,
        "You're sending messages too fast. Please wait a moment.",
        { replyToMessageId: messageId },
      );
      return new Response("OK", { status: 200 });
    }

    // 6. Store user message (strip @mention)
    const cleanText = messageText
      .replace(new RegExp(`@${botUsername}\\b`, "gi"), "")
      .trim();

    await ctx.runMutation(internal.messages.store, {
      chatId,
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
    });

    return new Response("OK", { status: 200 });
  }),
});

export default http;
