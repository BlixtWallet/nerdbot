import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    chatId: v.number(),
    messageThreadId: v.optional(v.number()),
    userId: v.optional(v.number()),
    userName: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    telegramMessageId: v.optional(v.number()),
    imageFileId: v.optional(v.string()),
    imageMimeType: v.optional(v.string()),
    imageFileSize: v.optional(v.number()),
    timestamp: v.number(),
  })
    .index("by_chat", ["chatId", "messageThreadId", "timestamp"])
    .index("by_chat_user_thread", ["chatId", "messageThreadId", "userId", "timestamp"])
    .index("by_chat_recent", ["chatId", "messageThreadId"]),

  chats: defineTable({
    chatId: v.number(),
    chatTitle: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    maxContextMessages: v.optional(v.number()),
    enabled: v.boolean(),
    createdAt: v.number(),
  }).index("by_chatId", ["chatId"]),

  rateLimits: defineTable({
    chatId: v.number(),
    userId: v.number(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_chat_user", ["chatId", "userId"]),
});
