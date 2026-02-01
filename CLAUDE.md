# Nerdbot

Telegram AI bot running on Convex. Uses raw fetch for Telegram Bot API. Default AI provider is Moonshot (Kimi K2). Also supports Claude, OpenAI, and Grok.

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
  telegram.ts        - Core bot logic (processMessage, processIssue actions, registerWebhook)
  messages.ts        - Internal mutations/queries for message storage
  crons.ts           - Daily cron job to prune old messages
  lib/
    ai.ts            - AI provider abstraction (Moonshot, Claude, OpenAI, Grok)
    telegramApi.ts   - Telegram Bot API helpers (sendMessage, sendChatAction, setWebhook)
    env.ts           - Environment variable helper (requireEnv)
    helpers.ts       - Pure logic extracted for testability (rate limiting, trigger logic, etc.)
    github.ts        - GitHub API helper (createGitHubIssue)
    logger.ts        - Structured wide-event logger (one JSON log line per request)
__tests__/
  unit/
    env.test.ts        - Tests for requireEnv (bun:test)
    ai.test.ts         - Tests for AI provider abstraction (bun:test)
    telegramApi.test.ts - Tests for Telegram API helpers (bun:test)
    helpers.test.ts    - Tests for rate limiting, trigger logic, command parsing, etc. (bun:test)
    github.test.ts     - Tests for GitHub API helper (bun:test)
    logger.test.ts     - Tests for structured logger (bun:test)
  convex/
    test.setup.ts      - Vitest module glob for convex-test
    messages.test.ts   - Integration tests for message mutations/queries (vitest + convex-test)
    http.test.ts       - Integration tests for webhook HTTP handler (vitest + convex-test)
    telegram.test.ts   - Integration tests for processMessage/processIssue actions (vitest + convex-test)
```

## Scripts

| Script              | Command                     | Description                                                     |
| ------------------- | --------------------------- | --------------------------------------------------------------- |
| `dev`               | `bun run dev`               | Start Convex dev server with hot reload                         |
| `deploy`            | `bun run deploy`            | Deploy to production                                            |
| `register-webhook`  | `bun run register-webhook`  | Register webhook URL with Telegram                              |
| `lint`              | `bun run lint`              | Run ESLint on convex/ and **tests**/                            |
| `lint:fix`          | `bun run lint:fix`          | Auto-fix lint issues                                            |
| `format`            | `bun run format`            | Format code with Prettier                                       |
| `format:check`      | `bun run format:check`      | Check formatting without writing                                |
| `test`              | `bun run test`              | Run all tests (unit + convex integration)                       |
| `test:unit`         | `bun run test:unit`         | Run unit tests only (bun:test in **tests**/unit/)               |
| `test:convex`       | `bun run test:convex`       | Run Convex integration tests only (vitest in **tests**/convex/) |
| `test:convex:watch` | `bun run test:convex:watch` | Run Convex tests in watch mode                                  |
| `typecheck`         | `bun run typecheck`         | Run TypeScript type checking                                    |
| `check`             | `bun run check`             | Run lint + format check + typecheck (all static checks)         |

## Linting & Formatting

- ESLint with `typescript-eslint` strict type-checked config + `@convex-dev/eslint-plugin`
- Prettier for formatting (semi, double quotes, trailing commas, 90 char width)
- `no-explicit-any` is an error — no `any` in the codebase, use typed interfaces instead
- `no-unsafe-*` rules are off (Convex generated types trigger false positives)
- Always run `bun run check` before committing

## Testing

- **Unit tests** live in `__tests__/unit/`, run with `bun run test:unit` (bun:test)
- **Convex integration tests** live in `__tests__/convex/`, run with `bun run test:convex` (vitest + convex-test)
- `bun run test` runs both test suites
- Pure logic is extracted into `convex/lib/helpers.ts` so it can be unit tested without a Convex backend
- Unit test files import source via relative paths (e.g. `../../convex/lib/ai`)
- Unit tests mock `globalThis.fetch` for HTTP-dependent code (AI providers, Telegram API)
- Convex tests use `convex-test` for in-memory DB, `t.fetch()` for HTTP actions, and `vi.stubGlobal("fetch", ...)` for external API calls
- Key areas covered: rate limiting, bot trigger logic, command parsing, mention stripping, response truncation, conversation formatting, all AI providers, Telegram API calls, GitHub API calls, env helpers, message CRUD, webhook routing, AI processing pipeline, issue creation

## Environment Variables

Set via `bunx convex env set <KEY> <VALUE>`:

| Variable                  | Description                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | From BotFather                                                                                                                                                                         |
| `TELEGRAM_WEBHOOK_SECRET` | Random string for webhook validation                                                                                                                                                   |
| `AI_PROVIDER`             | `"moonshot"`, `"claude"`, `"openai"`, or `"grok"` (default: `"moonshot"`)                                                                                                              |
| `AI_API_KEY`              | API key for chosen provider                                                                                                                                                            |
| `AI_MODEL`                | e.g. `"kimi-k2-0711-preview"`, `"claude-sonnet-4-20250514"`, `"gpt-4o"`, `"grok-4-1-fast-reasoning"`                                                                                   |
| `AI_THINKING`             | `"disabled"`, `"enabled"`, or `"auto"` thinking mode for Moonshot (default: `"disabled"`). Ignored by other providers.                                                                 |
| `BOT_USERNAME`            | `nerdbot` (without @)                                                                                                                                                                  |
| `RATE_LIMIT_PER_MINUTE`   | Max messages per user per group per minute (default: `10`)                                                                                                                             |
| `ALLOWED_USER_IDS`        | Comma-separated Telegram user IDs allowed to use the bot. **Required** — bot blocks everyone if not set                                                                                |
| `ALLOWED_GROUP_IDS`       | Comma-separated Telegram group/supergroup IDs the bot can operate in. **Required** for groups — private chats with allowed users always work                                           |
| `ALLOWED_ISSUE_USER_IDS`  | Comma-separated Telegram user IDs allowed to use `/issue`. Optional — if not set, all allowed users can create issues                                                                  |
| `MAX_CONTEXT_MESSAGES`    | Number of recent messages sent to the AI as context (default: `15`)                                                                                                                    |
| `MAX_RETAINED_MESSAGES`   | Number of messages kept per topic in the database before cron prunes (default: `100`)                                                                                                  |
| `WEB_SEARCH`              | Set to `"true"` to enable web search. Supported by Moonshot (client-side tool loop) and OpenAI/Grok (server-side via Responses API). Model decides when to search. (default: disabled) |
| `GITHUB_TOKEN`            | GitHub Personal Access Token with `repo` scope. Required for `/issue` command.                                                                                                         |
| `GITHUB_REPO`             | Target GitHub repository in `owner/repo` format (e.g. `user/nerdbot`). Required for `/issue` command.                                                                                  |

## Key Design Decisions

- **Async processing**: Webhook returns 200 immediately, AI work is scheduled via `ctx.scheduler.runAfter(0, ...)`. Prevents Telegram retry storms.
- **All messages stored**: Even messages the bot doesn't respond to are stored for conversation context.
- **Internal functions**: All mutations/queries called by the bot are internal (not exposed publicly).
- **Rate limiting**: Per-user, per-group sliding window. Configurable via `RATE_LIMIT_PER_MINUTE` (default: 10).
- **Forum/topic support**: Bot replies in the same thread it received a message from via `message_thread_id`.
- **Message cleanup**: Daily cron keeps only the latest 100 messages per chat, deletes the rest.
- **Wide-event logging**: One structured JSON log line per request via `createLogger()`. Build up context with `.set()`, emit once at the end with `.info()/.warn()/.error()`. No scattered `console.log` calls.

## Bot Commands

| Command          | Description                                            |
| ---------------- | ------------------------------------------------------ |
| `/help`          | Show help message                                      |
| `/reset`         | Clear conversation history for the chat                |
| `/issue <desc>`  | Create a GitHub issue from conversation context + desc |

## Bot Trigger Conditions

In groups, the bot responds when:

- Mentioned with `@nerdbot`
- Message is a `/` command

In private chats, the bot always responds.
