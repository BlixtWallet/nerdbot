import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

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
        await ctx.db.patch(existing._id, { chatTitle: args.chatTitle });
      }
      return existing;
    }

    const id = await ctx.db.insert("chats", {
      chatId: args.chatId,
      chatTitle: args.chatTitle,
      enabled: true,
      createdAt: Date.now(),
    });
    return await ctx.db.get(id);
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
    const windowMs = 60_000;

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_chat_user", (q) =>
        q.eq("chatId", args.chatId).eq("userId", args.userId),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("rateLimits", {
        chatId: args.chatId,
        userId: args.userId,
        windowStart: now,
        count: 1,
      });
      return true;
    }

    if (now - existing.windowStart > windowMs) {
      await ctx.db.patch(existing._id, {
        windowStart: now,
        count: 1,
      });
      return true;
    }

    if (existing.count >= maxPerMinute) {
      return false;
    }

    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
    });
    return true;
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
      await ctx.db.delete(msg._id);
    }
  },
});
