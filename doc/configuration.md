# Configuration Reference

All configuration is via an env file. By default `ctb` reads `.env`; use `ctb --env=.env2` or set `CTB_ENV` to choose a different file. `--env` takes precedence over `CTB_ENV`. Saved sessions and restart state are isolated by working directory plus the selected env file.

At startup, `ctb` resolves the env file to an absolute path and exports it as both `CTB_ENV` and `CTB_ENV_FILE`, which lets child processes inspect the active env file directly.

## Required

| Variable                 | Description                       |
| ------------------------ | --------------------------------- |
| `TELEGRAM_BOT_TOKEN`     | Bot token from @BotFather         |
| `TELEGRAM_ALLOWED_USERS` | Comma-separated Telegram user IDs |

## Recommended

| Variable             | Default | Description                      |
| -------------------- | ------- | -------------------------------- |
| `CLAUDE_WORKING_DIR` | `.`     | Working directory for Claude     |
| `CLAUDE_CODE_PATH`   | `~/.local/bin/claude` | Claude Code executable path used by `ctb` |
| `FIRST_PROMPT`       |         | Prompt injected into the first request of each new session |
| `OPENAI_API_KEY`     |         | Required for voice transcription |
| `ANTHROPIC_API_KEY`  |         | If no Claude CLI auth configured |

## Security

| Variable              | Default            | Description                                   |
| --------------------- | ------------------ | --------------------------------------------- |
| `ALLOWED_PATHS`       | `WORKING_DIR` only | Comma-separated directories Claude can access |
| `RATE_LIMIT_ENABLED`  | `true`             | Enable per-user rate limiting                 |
| `RATE_LIMIT_REQUESTS` | `20`               | Max requests per window                       |
| `RATE_LIMIT_WINDOW`   | `60`               | Window in seconds                             |

## Timeouts (ms)

| Variable                   | Default  | Description                        |
| -------------------------- | -------- | ---------------------------------- |
| `QUERY_TIMEOUT_MS`         | `180000` | Max query duration (3 min)         |
| `TIMEOUT_PROMPT_WAIT_MS`   | `30000`  | Wait for user response on timeout  |
| `MEDIA_GROUP_TIMEOUT_MS`   | `1000`   | Buffer for photo albums            |
| `STREAMING_THROTTLE_MS`    | `500`    | Min interval between message edits |
| `SHELL_COMMAND_TIMEOUT_MS` | `30000`  | Shell command timeout              |
| `SAVE_DEBOUNCE_MS`         | `500`    | Session save debounce              |

## Telegram Polling

| Variable                              | Default    | Description                                   |
| ------------------------------------- | ---------- | --------------------------------------------- |
| `TELEGRAM_POLLING_TIMEOUT_SEC`        | `30`       | Long-poll timeout sent to `getUpdates`        |
| `TELEGRAM_POLLING_RETRY_INTERVAL_MS`  | `1000`     | Delay between runner-level polling retries    |
| `TELEGRAM_POLLING_MAX_RETRY_MS`       | `54000000` | Total retry window before polling exits (15h) |

## Voice & Thinking

| Variable                 | Default | Description                                       |
| ------------------------ | ------- | ------------------------------------------------- |
| `TRANSCRIPTION_CONTEXT`  |         | Technical terms/names for better transcription    |
| `THINKING_KEYWORDS`      |         | Comma-separated keywords to trigger thinking mode |
| `THINKING_DEEP_KEYWORDS` |         | Keywords to trigger deep thinking mode            |

## Logging

| Variable              | Default                          | Description                       |
| --------------------- | -------------------------------- | --------------------------------- |
| `AUDIT_LOG_PATH`      | `/tmp/claude-telegram-audit.log` | Audit log location                |
| `AUDIT_LOG_JSON`      | `false`                          | Use JSON format                   |
| `LOG_LEVEL`           | `info`                           | Log level                         |
| `AUDIT_LOG_MAX_SIZE`  |                                  | Max log file size before rotation |
| `AUDIT_LOG_MAX_FILES` |                                  | Max rotated log files to keep     |

## MCP Servers

MCP servers are configured in `mcp-config.ts` (gitignored, copy from `mcp-config.example.ts`):

```typescript
import type { McpServerConfig } from "./src/types";

export const MCP_SERVERS: Record<string, McpServerConfig> = {
  "my-server": {
    command: "bun",
    args: ["run", "/path/to/server.ts"],
  },
  "http-server": {
    url: "http://localhost:3000/mcp",
  },
};
```
