# Configuration Reference

All configuration is via `.env` file (copy from `.env.example`).

## Required

| Variable                 | Description                       |
| ------------------------ | --------------------------------- |
| `TELEGRAM_BOT_TOKEN`     | Bot token from @BotFather         |
| `TELEGRAM_ALLOWED_USERS` | Comma-separated Telegram user IDs |

## Recommended

| Variable             | Default | Description                      |
| -------------------- | ------- | -------------------------------- |
| `CLAUDE_WORKING_DIR` | `.`     | Working directory for Claude     |
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
