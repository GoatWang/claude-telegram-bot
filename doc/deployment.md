# Deployment Guide

## Running Directly

```bash
bun run start                    # Run with src/bot.ts
bun run dev                      # Run with --watch (auto-reload)
```

## Running via CLI (Multi-Instance)

```bash
# Install globally
bun link

# Run for a specific project
ctb /path/to/project

# Or set working dir via env
CLAUDE_WORKING_DIR=/path/to/project bun run start
```

Each unique working directory gets isolated temp files via `INSTANCE_HASH`.

## Standalone Binary

```bash
bun build --compile src/cli/index.ts --outfile claude-bot-standalone
```

### PATH Requirements

Standalone binaries (especially from macOS apps) may not inherit Homebrew paths. Ensure PATH includes:

- `/opt/homebrew/bin` (Apple Silicon)
- `/usr/local/bin` (Intel)

Without this, `pdftotext` (for PDF parsing) won't be found.

### External Dependencies

```bash
brew install poppler  # Provides pdftotext for PDF extraction
```

## macOS LaunchAgent (Service)

```bash
cp launchagent/com.claude-telegram-ts.plist.template \
   ~/Library/LaunchAgents/com.claude-telegram-ts.plist

# Edit plist with your paths and environment variables
vim ~/Library/LaunchAgents/com.claude-telegram-ts.plist

# Load/unload
launchctl load ~/Library/LaunchAgents/com.claude-telegram-ts.plist
launchctl unload ~/Library/LaunchAgents/com.claude-telegram-ts.plist

# Restart
launchctl kickstart -k gui/$(id -u)/com.claude-telegram-ts

# Logs
tail -f /tmp/claude-telegram-bot-ts.log
tail -f /tmp/claude-telegram-bot-ts.err
```

## Telegram Bot Setup

1. Create bot via `@BotFather` → `/newbot`
2. **Disable privacy mode**: `@BotFather` → `/setprivacy` → select bot → **Disable** (required for `@mention` in groups)
3. Copy `.env.example` to `.env`, fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USERS`
4. Run `bun run start`
