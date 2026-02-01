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
  crons.ts           - Daily cron job to prune old messages
  lib/
    ai.ts            - AI provider abstraction (Moonshot, Claude, OpenAI)
    telegramApi.ts   - Telegram Bot API helpers (sendMessage, sendChatAction, setWebhook)
    env.ts           - Environment variable helper (requireEnv)
    helpers.ts       - Pure logic extracted for testability (rate limiting, trigger logic, etc.)
tests/
  env.test.ts        - Tests for requireEnv
  ai.test.ts         - Tests for AI provider abstraction
  telegramApi.test.ts - Tests for Telegram API helpers
  helpers.test.ts    - Tests for rate limiting, trigger logic, command parsing, etc.
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `bun run dev` | Start Convex dev server with hot reload |
| `deploy` | `bun run deploy` | Deploy to production |
| `register-webhook` | `bun run register-webhook` | Register webhook URL with Telegram |
| `lint` | `bun run lint` | Run ESLint on convex/ and tests/ |
| `lint:fix` | `bun run lint:fix` | Auto-fix lint issues |
| `format` | `bun run format` | Format code with Prettier |
| `format:check` | `bun run format:check` | Check formatting without writing |
| `test` | `bun test` | Run all unit tests |
| `typecheck` | `bun run typecheck` | Run TypeScript type checking |

## Linting & Formatting

- ESLint with `typescript-eslint` strict type-checked config + `@convex-dev/eslint-plugin`
- Prettier for formatting (semi, double quotes, trailing commas, 90 char width)
- `no-explicit-any` is an error — no `any` in the codebase, use typed interfaces instead
- `no-unsafe-*` rules are off (Convex generated types trigger false positives)
- Always run `bun run lint` and `bun run format:check` before committing

## Testing

- Tests live in `tests/` at the project root, run with `bun test`
- Pure logic is extracted into `convex/lib/helpers.ts` so it can be unit tested without a Convex backend
- Test files import source via relative paths (e.g. `../convex/lib/ai`)
- Tests mock `globalThis.fetch` for HTTP-dependent code (AI providers, Telegram API)
- Key areas covered: rate limiting, bot trigger logic, command parsing, mention stripping, response truncation, conversation formatting, all AI providers, Telegram API calls, env helpers

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
- **Forum/topic support**: Bot replies in the same thread it received a message from via `message_thread_id`.
- **Message cleanup**: Daily cron keeps only the latest 100 messages per chat, deletes the rest.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help message |
| `/reset` | Clear conversation history for the chat |

## Bot Trigger Conditions

In groups, the bot responds when:
- Mentioned with `@nerdbot`
- Message is a `/` command

In private chats, the bot always responds.
