# Nerdbot

Telegram AI bot running on Convex. Uses raw fetch for Telegram Bot API. Default AI provider is Moonshot (Kimi K2). Also supports Claude and OpenAI.

## Tooling

Default to Bun instead of Node.js.

- `bun install` instead of npm/yarn/pnpm install
- `bunx <package>` instead of npx
- `bun run <script>` instead of npm run

## Project Structure

```
convex/
  schema.ts          - Database schema (messages, chats, rateLimits)
  http.ts            - HTTP webhook endpoint (POST /api/telegram-webhook)
  telegram.ts        - Core bot logic (processMessage action, registerWebhook)
  messages.ts        - Internal mutations/queries for message storage
  lib/
    ai.ts            - AI provider abstraction (Moonshot, Claude, OpenAI)
    telegramApi.ts   - Telegram Bot API helpers (sendMessage, sendChatAction, setWebhook)
    env.ts           - Environment variable helper (requireEnv)
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `bun run dev` | Start Convex dev server with hot reload |
| `deploy` | `bun run deploy` | Deploy to production |
| `register-webhook` | `bun run register-webhook` | Register webhook URL with Telegram |
| `lint` | `bun run lint` | Run ESLint on convex/ |
| `lint:fix` | `bun run lint:fix` | Auto-fix lint issues |
| `format` | `bun run format` | Format code with Prettier |
| `format:check` | `bun run format:check` | Check formatting without writing |
| `typecheck` | `bun run typecheck` | Run TypeScript type checking |

## Linting & Formatting

- ESLint with `typescript-eslint` strict type-checked config
- Prettier for formatting (semi, double quotes, trailing commas, 90 char width)
- `no-explicit-any` is a warning (needed for untyped Telegram/AI API responses)
- `no-unsafe-*` rules are off (Convex generated types trigger false positives)
- Always run `bun run lint` and `bun run format:check` before committing

## Environment Variables

Set via `bunx convex env set <KEY> <VALUE>`:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | From BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random string for webhook validation |
| `AI_PROVIDER` | `"moonshot"`, `"claude"`, or `"openai"` (default: `"moonshot"`) |
| `AI_API_KEY` | API key for chosen provider |
| `AI_MODEL` | e.g. `"kimi-k2-0711-preview"`, `"claude-sonnet-4-20250514"`, `"gpt-4o"` |
| `BOT_USERNAME` | `nerdbot` (without @) |

## Key Design Decisions

- **Async processing**: Webhook returns 200 immediately, AI work is scheduled via `ctx.scheduler.runAfter(0, ...)`. Prevents Telegram retry storms.
- **All messages stored**: Even messages the bot doesn't respond to are stored for conversation context.
- **Internal functions**: All mutations/queries called by the bot are internal (not exposed publicly).
- **Rate limiting**: Per-user, per-group, 10 requests/minute sliding window.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help message |
| `/reset` | Clear conversation history for the chat |

## Bot Trigger Conditions

In groups, the bot responds when:
- Mentioned with `@nerdbot`
- Message is a reply to the bot's message
- Message is a `/` command

In private chats, the bot always responds.
