import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { evaluateRateLimit } from "./lib/helpers";

export const store = internalMutation({
  args: {
    chatId: v.number(),
    userId: v.optional(v.number()),
    userName: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    telegramMessageId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const getRecent = internalQuery({
  args: {
    chatId: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 30;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .order("desc")
      .take(limit);

    return messages.reverse();
  },
});

export const ensureChat = internalMutation({
  args: {
    chatId: v.number(),
    chatTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chats")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();

    if (existing) {
      if (args.chatTitle && args.chatTitle !== existing.chatTitle) {
        await ctx.db.patch("chats", existing._id, { chatTitle: args.chatTitle });
      }
      return existing;
    }

    const id = await ctx.db.insert("chats", {
      chatId: args.chatId,
      chatTitle: args.chatTitle,
      enabled: true,
      createdAt: Date.now(),
    });
    return await ctx.db.get("chats", id);
  },
});

export const getChat = internalQuery({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chats")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
  },
});

export const checkRateLimit = internalMutation({
  args: {
    chatId: v.number(),
    userId: v.number(),
    maxPerMinute: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxPerMinute = args.maxPerMinute ?? 10;
    const now = Date.now();

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_chat_user", (q) =>
        q.eq("chatId", args.chatId).eq("userId", args.userId),
      )
      .unique();

    const result = evaluateRateLimit(
      existing ? { windowStart: existing.windowStart, count: existing.count } : null,
      now,
      maxPerMinute,
    );

    if (result.insert) {
      await ctx.db.insert("rateLimits", {
        chatId: args.chatId,
        userId: args.userId,
        ...result.insert,
      });
    } else if (result.update && existing) {
      await ctx.db.patch("rateLimits", existing._id, result.update);
    }

    return result.allowed;
  },
});

export const clearChat = internalMutation({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    for (const msg of messages) {
      await ctx.db.delete("messages", msg._id);
    }
  },
});

// Delete old messages across all chats, keeping the latest 100 per chat.
export const deleteOldMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all distinct chats that have messages
    const chats = await ctx.db.query("chats").collect();

    let totalDeleted = 0;
    for (const chat of chats) {
      // Get messages beyond the 100 most recent
      const oldMessages = await ctx.db
        .query("messages")
        .withIndex("by_chat", (q) => q.eq("chatId", chat.chatId))
        .order("desc")
        .collect();

      // Skip the first 100 (newest), delete the rest
      const toDelete = oldMessages.slice(100);
      for (const msg of toDelete) {
        await ctx.db.delete("messages", msg._id);
      }
      totalDeleted += toDelete.length;
    }

    if (totalDeleted > 0) {
      console.log(`Cron: deleted ${String(totalDeleted)} old messages`);
    }
  },
});
