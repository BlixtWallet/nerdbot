import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { generateResponse, type ConversationMessage } from "./lib/ai";
import { sendMessage, sendChatAction, setWebhook } from "./lib/telegramApi";
import { requireEnv } from "./lib/env";

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant in a Telegram group chat.
Keep responses concise and conversational — this is a chat, not an essay.
If multiple people are talking, pay attention to who said what.
Use plain text (no markdown) since Telegram groups render it poorly.
If you don't know something, say so.`;

export const processMessage = internalAction({
  args: {
    chatId: v.number(),
    userId: v.number(),
    userName: v.string(),
    messageText: v.string(),
    messageId: v.number(),
  },
  handler: async (ctx, args) => {
    const token = requireEnv("TELEGRAM_BOT_TOKEN");
    const aiProvider = process.env.AI_PROVIDER ?? "claude";
    const aiApiKey = requireEnv("AI_API_KEY");
    const aiModel =
      process.env.AI_MODEL ??
      (aiProvider === "claude" ? "claude-sonnet-4-20250514" : "gpt-4o");

    try {
      await sendChatAction(token, args.chatId);

      const chatConfig = await ctx.runQuery(internal.messages.getChat, {
        chatId: args.chatId,
      });

      const systemPrompt = chatConfig?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
      const maxContext = chatConfig?.maxContextMessages ?? 30;

      const recentMessages = await ctx.runQuery(internal.messages.getRecent, {
        chatId: args.chatId,
        limit: maxContext,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conversation: ConversationMessage[] = recentMessages.map((msg: any) => ({
        role: msg.role as "user" | "assistant",
        content:
          msg.role === "user"
            ? `[${String(msg.userName ?? "Unknown")}]: ${String(msg.text)}`
            : String(msg.text),
      }));

      const aiResponse = await generateResponse(
        aiProvider,
        aiApiKey,
        aiModel,
        systemPrompt,
        conversation,
      );

      let responseText = aiResponse.text;
      if (responseText.length > 4000) {
        responseText = responseText.slice(0, 4000) + "\n\n[truncated]";
      }

      await ctx.runMutation(internal.messages.store, {
        chatId: args.chatId,
        role: "assistant",
        text: responseText,
      });

      await sendMessage(token, args.chatId, responseText, {
        replyToMessageId: args.messageId,
      });
    } catch (error: unknown) {
      console.error("Error processing message:", error);

      await sendMessage(
        token,
        args.chatId,
        "Sorry, I encountered an error processing that message. Please try again.",
        { replyToMessageId: args.messageId },
      );
    }
  },
});

export const registerWebhook = action({
  args: {},
  handler: async () => {
    const token = requireEnv("TELEGRAM_BOT_TOKEN");
    const secret = requireEnv("TELEGRAM_WEBHOOK_SECRET");
    const convexUrl = requireEnv("CONVEX_SITE_URL");
    const webhookUrl = `${convexUrl}/api/telegram-webhook`;

    const result = await setWebhook(token, webhookUrl, secret);
    console.log("Webhook registration result:", result);
    return result;
  },
});
