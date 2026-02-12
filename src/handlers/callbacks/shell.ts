/**
 * Shell command confirmation callback handler for Claude Telegram Bot.
 */

import type { Context } from "grammy";
import { MESSAGE_EFFECTS } from "../../config";
import { sessionManager } from "../../session";
import { auditLog, effectFor } from "../../utils";
import { execShellCommand } from "../text";

/**
 * Handle shell command confirmation callbacks.
 * Format: shell:run:base64cmd or shell:cancel
 */
export async function handleShellCallback(
	ctx: Context,
	userId: number,
	username: string,
	callbackData: string,
): Promise<void> {
	const parts = callbackData.split(":");
	const action = parts[1];

	if (action === "cancel") {
		await ctx.answerCallbackQuery({ text: "Cancelled" });
		try {
			await ctx.editMessageText("❌ Command cancelled");
		} catch {
			// Message may have been deleted
		}
		return;
	}

	if (action === "run") {
		const encodedCmd = parts.slice(2).join(":"); // Handle colons in base64
		let shellCmd: string;
		try {
			shellCmd = Buffer.from(encodedCmd, "base64").toString("utf-8");
		} catch {
			await ctx.answerCallbackQuery({ text: "Invalid command" });
			return;
		}

		await ctx.answerCallbackQuery({ text: "Running..." });

		const chatId = ctx.chat?.id;
		if (!chatId) return;
		const session = sessionManager.getSession(chatId);
		const cwd = session.workingDir;
		try {
			await ctx.editMessageText(
				`⚡ Running in <code>${cwd}</code>:\n<code>${shellCmd}</code>`,
				{ parse_mode: "HTML" },
			);
		} catch {
			// Message may have been deleted
		}

		const { stdout, stderr, exitCode } = await execShellCommand(shellCmd, cwd);
		const output = (stdout + stderr).trim();
		const maxLen = 4000;
		const truncated =
			output.length > maxLen
				? `${output.slice(0, maxLen)}...(truncated)`
				: output;

		const statusEmoji = exitCode === 0 ? "✅" : "❌";
		// 👍 Thumbs Up for success, 👎 Thumbs Down for failure
		const effectId =
			exitCode === 0 ? MESSAGE_EFFECTS.THUMBS_UP : MESSAGE_EFFECTS.THUMBS_DOWN;
		await ctx.reply(
			`${statusEmoji} Exit code: ${exitCode}\n<pre>${truncated || "(no output)"}</pre>`,
			{ parse_mode: "HTML", message_effect_id: effectFor(ctx, effectId) },
		);
		await auditLog(userId, username, "SHELL", shellCmd, `exit=${exitCode}`);
		return;
	}

	await ctx.answerCallbackQuery({ text: "Unknown action" });
}
