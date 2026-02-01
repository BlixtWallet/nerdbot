# Nerdbot

A Telegram AI chatbot powered by Convex. Default AI provider is Moonshot (Kimi K2). Also supports Claude and OpenAI. Works in group chats and private messages.

## Setup

### Prerequisites

- [Bun](https://bun.sh)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A [Moonshot](https://platform.moonshot.ai/) API key (or Claude/OpenAI)

### Install

```bash
bun install
```

### Configure Convex

```bash
bunx convex dev --once --configure=new
```

### Set Environment Variables

```bash
bunx convex env set TELEGRAM_BOT_TOKEN "your-token-from-botfather"
bunx convex env set TELEGRAM_WEBHOOK_SECRET "any-random-secret-string"
bunx convex env set AI_PROVIDER "moonshot"
bunx convex env set AI_API_KEY "your-moonshot-api-key"
bunx convex env set AI_MODEL "kimi-k2-0711-preview"
bunx convex env set BOT_USERNAME "nerdbot"
bunx convex env set ALLOWED_USER_IDS "comma-separated-telegram-user-ids"
bunx convex env set ALLOWED_GROUP_IDS "comma-separated-telegram-group-ids"
```

Optional settings (have sensible defaults):

```bash
bunx convex env set RATE_LIMIT_PER_MINUTE "10"
bunx convex env set MAX_CONTEXT_MESSAGES "30"
bunx convex env set MAX_RETAINED_MESSAGES "100"
bunx convex env set MOONSHOT_WEB_SEARCH "true"
```

### Register Webhook

```bash
bunx convex run telegram:registerWebhook
```

### BotFather Configuration

1. `/setprivacy` -> Select your bot -> **Disable** (so the bot can read group messages for context)
2. `/setcommands` -> Set:
   ```
   help - Show help message
   reset - Clear conversation history
   ```

## Development

```bash
bunx convex dev
```

## Testing

```bash
bun test
```

Tests are in `tests/` and cover rate limiting, bot trigger logic, command parsing, mention stripping, response truncation, conversation formatting, AI providers, Telegram API calls, and structured logging.

## Deploy

```bash
bunx convex deploy
```

## Usage

- **Groups**: Add @nerdbot to a group. Mention it with `@nerdbot` to chat. Supports forum topics — replies in the same thread.
- **Private chat**: Message the bot directly.
- `/reset` clears conversation history for the current chat.
- Messages older than the latest 100 per topic are automatically pruned daily (configurable via `MAX_RETAINED_MESSAGES`).
- Only whitelisted users and groups can interact with the bot — check Convex logs for blocked user/group IDs.
- **Web search**: When `MOONSHOT_WEB_SEARCH` is enabled, the model can autonomously search the web to answer questions about current events or look up information.
- **Structured logging**: All logs are emitted as single JSON lines per request (wide events). Check the Convex dashboard for structured logs with fields like `event`, `chatId`, `userId`, `provider`, `inputTokens`, etc.
