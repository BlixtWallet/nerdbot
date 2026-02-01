# Nerdbot

A Telegram AI chatbot powered by Convex. Default AI provider is Moonshot (Kimi K2). Also supports Claude, OpenAI, and Grok. Works in group chats and private messages.

## Setup

### Prerequisites

- [Bun](https://bun.sh)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A [Moonshot](https://platform.moonshot.ai/) API key (or Claude/OpenAI/[xAI Grok](https://console.x.ai/))

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
bunx convex env set MAX_CONTEXT_MESSAGES "15"
bunx convex env set MAX_RETAINED_MESSAGES "100"
bunx convex env set WEB_SEARCH "true"
bunx convex env set AI_THINKING "disabled"
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
bun run test          # run all tests (unit + convex integration)
bun run test:unit     # unit tests only (bun:test)
bun run test:convex   # convex integration tests only (vitest + convex-test)
```

Tests are in `__tests__/`:

- **`__tests__/unit/`** — Unit tests for pure helpers, AI providers, Telegram API, env, and structured logging (bun:test)
- **`__tests__/convex/`** — Integration tests for Convex functions: message CRUD, webhook routing, rate limiting, and AI processing pipeline (vitest + [convex-test](https://www.npmjs.com/package/convex-test))

## Static Checks

```bash
bun run check         # lint + format check + typecheck
```

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
- **Web search**: When `WEB_SEARCH` is enabled, the model can autonomously search the web to answer questions about current events or look up information. Supported by Moonshot, OpenAI, and Grok.
- **Thinking control (Moonshot)**: Set `AI_THINKING` to `disabled`, `enabled`, or `auto` (e.g. `disabled` for kimi-k2.5).
- **Structured logging**: All logs are emitted as single JSON lines per request (wide events). Check the Convex dashboard for structured logs with fields like `event`, `chatId`, `userId`, `provider`, `inputTokens`, etc.
