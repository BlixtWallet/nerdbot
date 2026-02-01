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

## Deploy

```bash
bunx convex deploy
```

## Usage

- **Groups**: Add @nerdbot to a group. Mention it with `@nerdbot` or reply to its messages.
- **Private chat**: Message the bot directly.
- `/reset` clears conversation history for the current chat.
