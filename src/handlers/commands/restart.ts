/**
 * Bot restart command handlers.
 *
 * /restart
 */

import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { RESTART_FILE } from "../../config";
import { sessionManager } from "../../session";
import { checkCommandAuth } from "./utils";

/**
 * Execute the restart process.
 */
export async function executeRestart(
	ctx: Context,
	chatId: number | undefined,
): Promise<void> {
	// Determine restart command based on how bot was started
	const botScript = process.argv[1] || "";
	const isCliMode =
		botScript.includes("cli.ts") || botScript.includes("cli.js");
	const isBinary = !botScript.endsWith(".ts") && !botScript.endsWith(".js");

	let restartCommand: string;
	let logFile: string;

	if (isBinary) {
		// Standalone binary mode
		restartCommand = process.argv[0] || "";
		logFile = "/tmp/claude-telegram-bot.log";
	} else if (isCliMode) {
		// CLI mode (ctb)
		restartCommand = `bun "${botScript}"`;
		logFile = "/tmp/claude-telegram-bot.log";
	} else {
		// Development mode (bun run src/index.ts or src/bot.ts)
		restartCommand = `bun run "${botScript}"`;
		logFile = "/tmp/claude-telegram-bot.log";
	}

	const msg = await ctx.reply("\u{1F504} Restarting bot...");

	// Save message info so we can update it after restart
	if (chatId && msg.message_id) {
		try {
			await Bun.write(
				RESTART_FILE,
				JSON.stringify({
					chat_id: chatId,
					message_id: msg.message_id,
					timestamp: Date.now(),
					log_file: logFile,
				}),
			);
		} catch (e) {
			console.warn("Failed to save restart info:", e);
		}
	}

	// Give time for the message to send
	await Bun.sleep(500);

	// Spawn a new process to restart the bot
	const { spawn } = await import("node:child_process");
	const cwd = process.cwd();

	// Build the restart command with log redirection
	const fullCommand = `sleep 1 && cd "${cwd}" && ${restartCommand} >> ${logFile} 2>&1 & echo $!`;

	// Spawn detached process that will restart after current process exits
	spawn("sh", ["-c", fullCommand], {
		detached: true,
		stdio: "ignore",
	}).unref();

	// Exit current process
	process.exit(0);
}

/**
 * /restart - Restart the bot process.
 */
export async function handleRestart(ctx: Context): Promise<void> {
	if (!(await checkCommandAuth(ctx))) return;

	const chatId = ctx.chat?.id;
	if (!chatId) return;

	const session = sessionManager.getSession(chatId);

	// Detect if running in terminal mode
	const isTTY = process.stdout.isTTY;

	// Determine restart command based on how bot was started
	const botScript = process.argv[1] || "";
	const isCliMode =
		botScript.includes("cli.ts") || botScript.includes("cli.js");
	const isBinary = !botScript.endsWith(".ts") && !botScript.endsWith(".js");

	let restartCommand: string;
	let logFile: string;

	if (isBinary) {
		// Standalone binary mode
		restartCommand = process.argv[0] || "";
		logFile = "/tmp/claude-telegram-bot.log";
	} else if (isCliMode) {
		// CLI mode (ctb)
		restartCommand = `bun "${botScript}"`;
		logFile = "/tmp/claude-telegram-bot.log";
	} else {
		// Development mode (bun run src/index.ts or src/bot.ts)
		restartCommand = `bun run "${botScript}"`;
		logFile = "/tmp/claude-telegram-bot.log";
	}

	// Warn if running in terminal
	if (isTTY) {
		const keyboard = new InlineKeyboard()
			.text("\u2705 \u78BA\u5B9A\u91CD\u555F", "restart:confirm")
			.text("\u274C \u53D6\u6D88", "restart:cancel");

		await ctx.reply(
			"\u26A0\uFE0F <b>Terminal Mode Detected</b>\n\n" +
				"You started the bot from a terminal. Restarting will:\n" +
				"\u2022 Detach from your current terminal session\n" +
				"\u2022 Run in background\n" +
				`\u2022 Log to: <code>${logFile}</code>\n\n` +
				"View logs after restart:\n" +
				`<code>tail -f ${logFile}</code>\n\n` +
				"Or stop and restart manually:\n" +
				"\u2022 Press Ctrl+C\n" +
				`\u2022 Run <code>${restartCommand}</code>`,
			{ parse_mode: "HTML", reply_markup: keyboard },
		);

		// Don't proceed - wait for user to click button
		return;
	}

	// Not in TTY mode, proceed with restart directly
	await executeRestart(ctx, chatId);
}
