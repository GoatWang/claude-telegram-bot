/**
 * Pending message callback handler for Claude Telegram Bot.
 */

import type { Context } from "grammy";
import { MESSAGE_EFFECTS } from "../../config";
import { formatUserError } from "../../errors";
import { queryQueue } from "../../query-queue";
import { sessionManager } from "../../session";
import { auditLog, effectFor, startTypingIndicator } from "../../utils";
import { createStatusCallback, StreamingState } from "../streaming";

/**
 * Handle pending message callbacks.
 * Format: pending:exec:{id} or pending:clear
 */
export async function handlePendingCallback(
	ctx: Context,
	userId: number,
	username: string,
	callbackData: string,
): Promise<void> {
	const chatId = ctx.chat?.id;
	if (!chatId) return;
	const session = sessionManager.getSession(chatId);

	const parts = callbackData.split(":");
	const action = parts[1];

	if (action === "clear") {
		session.clearPendingMessages();
		await ctx.answerCallbackQuery({ text: "Cleared all pending messages" });
		try {
			await ctx.editMessageText("📭 Pending messages cleared.");
		} catch {
			// Message may have been deleted
		}
		return;
	}

	if (action === "exec") {
		const msgId = parts[2];
		if (!msgId) {
			await ctx.answerCallbackQuery({ text: "Invalid message ID" });
			return;
		}

		const message = session.removePendingMessage(msgId);
		if (!message) {
			await ctx.answerCallbackQuery({ text: "Message not found or expired" });
			return;
		}

		// Check if session is busy
		if (session.isRunning) {
			// Re-queue the message
			session.addPendingMessage(message);
			await ctx.answerCallbackQuery({
				text: "Session busy. Message re-queued.",
			});
			return;
		}

		await ctx.answerCallbackQuery({ text: "Executing..." });

		// Delete the pending list message
		try {
			await ctx.deleteMessage();
		} catch {
			// Message may have been deleted
		}

		// Execute the message
		const typing = startTypingIndicator(ctx);
		const state = new StreamingState();
		const statusCallback = createStatusCallback(ctx, state, ctx.chat?.id);

		try {
			const response = await queryQueue.sendMessage(
				session,
				message,
				username,
				userId,
				statusCallback,
				ctx.chat?.id,
				ctx,
			);
			await auditLog(userId, username, "PENDING_EXEC", message, response);
		} catch (error) {
			console.error("Error executing pending message:", error);
			const userMessage = formatUserError(
				error instanceof Error ? error : new Error(String(error)),
			);
			await ctx.reply(`❌ ${userMessage}`, {
				message_effect_id: effectFor(ctx, MESSAGE_EFFECTS.THUMBS_DOWN),
			});
		} finally {
			typing.stop();
		}
		return;
	}

	await ctx.answerCallbackQuery({ text: "Unknown action" });
}
