# Nerdbot

A Telegram AI chatbot powered by Convex. Supports Claude and OpenAI as AI backends. Works in group chats and private messages.

## Setup

### Prerequisites

- [Bun](https://bun.sh)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A Claude or OpenAI API key

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
bunx convex env set AI_PROVIDER "claude"
bunx convex env set AI_API_KEY "your-api-key"
bunx convex env set AI_MODEL "claude-sonnet-4-20250514"
bunx convex env set BOT_USERNAME "nerdbot"
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
   setprompt - Set a custom system prompt
   ```

## Development

```bash
bunx convex dev
```

## Deploy

```bash
bunx convex deploy
```

## Usage

- **Groups**: Add @nerdbot to a group. Mention it with `@nerdbot` or reply to its messages.
- **Private chat**: Message the bot directly.
- `/reset` clears conversation history for the current chat.
- `/setprompt <text>` customizes the bot's personality for the current chat.
