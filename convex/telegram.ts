import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { generateResponse } from "./lib/ai";
import { sendMessage, sendChatAction, setWebhook } from "./lib/telegramApi";
import { requireEnv } from "./lib/env";
import { formatConversation, truncateResponse } from "./lib/helpers";

const DEFAULT_SYSTEM_PROMPT = `You are Nerdbot, the resident AI in a Telegram group of tech-savvy nerds.
You're witty, sharp, and love banter. Keep it casual and concise — no essays.
You enjoy talking about tech, programming, politics, memes, and whatever else comes up.
The group leans right politically — you can engage with that naturally without being preachy or lecturing.
Roast people when appropriate. Be funny. Don't be a corporate robot.
If multiple people are talking, pay attention to who said what.
Use plain text, no markdown formatting.
If you don't know something, just say so.`;

export const processMessage = internalAction({
  args: {
    chatId: v.number(),
    userId: v.number(),
    userName: v.string(),
    messageText: v.string(),
    messageId: v.number(),
    messageThreadId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = requireEnv("TELEGRAM_BOT_TOKEN");
    const aiProvider = process.env.AI_PROVIDER ?? "moonshot";
    const aiApiKey = requireEnv("AI_API_KEY");
    const aiModel = process.env.AI_MODEL ?? "kimi-k2-0711-preview";

    try {
      await sendChatAction(token, args.chatId, "typing", args.messageThreadId);

      const chatConfig = await ctx.runQuery(internal.messages.getChat, {
        chatId: args.chatId,
      });

      const systemPrompt = chatConfig?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
      const maxContext = chatConfig?.maxContextMessages ?? 30;

      const recentMessages = await ctx.runQuery(internal.messages.getRecent, {
        chatId: args.chatId,
        limit: maxContext,
      });

      const conversation = formatConversation(recentMessages);

      const aiResponse = await generateResponse(
        aiProvider,
        aiApiKey,
        aiModel,
        systemPrompt,
        conversation,
      );

      const responseText = truncateResponse(aiResponse.text);

      await ctx.runMutation(internal.messages.store, {
        chatId: args.chatId,
        role: "assistant",
        text: responseText,
      });

      await sendMessage(token, args.chatId, responseText, {
        replyToMessageId: args.messageId,
        messageThreadId: args.messageThreadId,
      });
    } catch (error: unknown) {
      console.error("Error processing message:", error);

      await sendMessage(
        token,
        args.chatId,
        "Sorry, I encountered an error processing that message. Please try again.",
        {
          replyToMessageId: args.messageId,
          messageThreadId: args.messageThreadId,
        },
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
