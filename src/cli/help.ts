import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Read version from package.json (with fallback for compiled binaries)
// CTB_BUILD_VERSION is injected at compile time via --define
declare const CTB_BUILD_VERSION: string | undefined;

let version = "unknown";
try {
	if (typeof CTB_BUILD_VERSION !== "undefined") {
		version = CTB_BUILD_VERSION;
	} else {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const packageJsonPath = join(__dirname, "..", "..", "package.json");
		version = JSON.parse(readFileSync(packageJsonPath, "utf-8")).version;
	}
} catch {
	// Compiled binary — package.json not available at runtime
}
export const VERSION = version;

export function showHelp(): void {
	console.log(`
ctb - Claude Telegram Bot

Run a Telegram bot that controls Claude Code in your project directory.

USAGE:
  ctb [options]
  ctb version          Show version number
  ctb help             Show this help message
  ctb tut              Show setup tutorial

OPTIONS:
  --help, -h       Show this help message
  --version, -v    Show version
  --token=TOKEN    Override TELEGRAM_BOT_TOKEN from .env
  --users=IDS      Override TELEGRAM_ALLOWED_USERS (comma-separated)
  --dir=PATH       Override working directory (default: current directory)
  --chrome         Enable Chrome browser automation (requires Claude in Chrome extension)

ENVIRONMENT:
  Reads .env from current directory. Required variables:
    TELEGRAM_BOT_TOKEN      - Bot token from @BotFather
    TELEGRAM_ALLOWED_USERS  - Comma-separated Telegram user IDs

EXAMPLES:
  cd ~/my-project && ctb           # Start bot for this project
  ctb --dir=/path/to/project       # Start bot for specific directory
  ctb --token=xxx --users=123,456  # Override env vars

Multiple instances can run simultaneously in different directories.
`);
}

export function showTutorial(): void {
	console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    CTB Setup Tutorial                            ║
╚══════════════════════════════════════════════════════════════════╝

Follow these steps to set up your Claude Telegram Bot:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1: Create a Telegram Bot
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Open Telegram and search for @BotFather
2. Send /newbot
3. Follow the prompts:
   - Choose a name (e.g., "My Claude Bot")
   - Choose a username (must end in "bot", e.g., "my_claude_bot")
4. Copy the token that looks like:
   1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2: Get Your Telegram User ID
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Open Telegram and search for @userinfobot
2. Send any message to it
3. It will reply with your user ID (a number like 123456789)
4. Copy this number

   Tip: Add multiple user IDs separated by commas for team access

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3: Configure the Bot
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Option A: Interactive setup (easiest)
  Just run: ctb
  It will prompt you for the token and user IDs.

Option B: Create a .env file
  Create a file named .env in your project directory:

  TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
  TELEGRAM_ALLOWED_USERS=123456789,987654321

Option C: Use command-line arguments
  ctb --token=YOUR_TOKEN --users=YOUR_USER_ID

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4: Set Up Bot Commands (Optional)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Go back to @BotFather
2. Send /setcommands
3. Select your bot
4. Paste this command list:

start - Show status and user ID
new - Start a fresh session
resume - Resume last session
stop - Interrupt current query
status - Check what Claude is doing
undo - Revert file changes
cd - Change working directory
file - Download a file
bookmarks - Manage directory bookmarks
retry - Retry last message
restart - Restart the bot

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5: Start the Bot
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cd ~/your-project
  ctb

The bot will start and show "Bot started: @your_bot_username"
Open Telegram and message your bot to start using Claude!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Need help? https://github.com/htlin/claude-telegram-bot
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}
