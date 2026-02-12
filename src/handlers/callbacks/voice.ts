/**
 * Voice confirmation callback handler for Claude Telegram Bot.
 */

import type { Context } from "grammy";
import { MESSAGE_EFFECTS } from "../../config";
import { formatUserError } from "../../errors";
import { queryQueue } from "../../query-queue";
import { sessionManager } from "../../session";
import { withRetry } from "../../telegram-api";
import { auditLog, effectFor, startTypingIndicator } from "../../utils";
import { createStatusCallback, StreamingState } from "../streaming";

/**
 * Handle voice confirmation callbacks.
 * Format: voice:confirm:{data}, voice:cancel, voice:edit:{data}
 */
export async function handleVoiceCallback(
	ctx: Context,
	userId: number,
	username: string,
	chatId: number,
	callbackData: string,
): Promise<void> {
	const session = sessionManager.getSession(chatId);

	const parts = callbackData.split(":");
	const action = parts[1];

	if (action === "cancel") {
		await ctx.answerCallbackQuery({ text: "已取消" });
		try {
			await ctx.editMessageText("❌ 語音訊息已取消");
		} catch {
			// Message may have been deleted
		}
		return;
	}

	if (action === "confirm" || action === "edit") {
		const encodedData = parts.slice(2).join(":");
		let transcript = "";

		try {
			const data = JSON.parse(Buffer.from(encodedData, "base64").toString());
			transcript = data.transcript || "";
		} catch {
			await ctx.answerCallbackQuery({ text: "無效的資料" });
			return;
		}

		if (!transcript) {
			await ctx.answerCallbackQuery({ text: "找不到轉錄文字" });
			return;
		}

		if (action === "edit") {
			// Request user to send additional text
			await ctx.answerCallbackQuery({ text: "請輸入補充文字" });
			try {
				await ctx.editMessageText(
					`✏️ 原始轉錄：\n"${transcript}"\n\n請輸入您要補充的文字，將會附加在原文後面：`,
				);
			} catch {
				await ctx.reply(
					`✏️ 原始轉錄：\n"${transcript}"\n\n請輸入您要補充的文字：`,
				);
			}

			// Store transcript for the next message
			session.setPendingVoiceEdit(userId, transcript);
			return;
		}

		// action === "confirm"
		await ctx.answerCallbackQuery({ text: "正在處理..." });

		// Update message to show confirmation
		try {
			await ctx.editMessageText(`✅ 已確認：\n"${transcript}"`);
		} catch {
			// Message may have been deleted
		}

		// Send to Claude
		const typing = startTypingIndicator(ctx);
		const state = new StreamingState();
		const statusCallback = createStatusCallback(ctx, state, ctx.chat?.id);

		try {
			const response = await queryQueue.sendMessage(
				session,
				transcript,
				username,
				userId,
				statusCallback,
				chatId,
				ctx,
			);

			await auditLog(userId, username, "VOICE_CONFIRM", transcript, response);
		} catch (error) {
			console.error("Error processing voice confirmation:", error);

			for (const toolMsg of state.toolMessages) {
				try {
					await ctx.api.deleteMessage(toolMsg.chat.id, toolMsg.message_id);
				} catch (error) {
					console.debug("Failed to delete tool message:", error);
				}
			}

			const errorStr = String(error);
			const isClaudeCodeCrash = errorStr
				.toLowerCase()
				.includes("process exited with code");

			if (errorStr.includes("abort") || errorStr.includes("cancel")) {
				const wasInterrupt = session.consumeInterruptFlag();
				if (!wasInterrupt) {
					await withRetry(() => ctx.reply("🛑 Query stopped."));
				}
			} else if (isClaudeCodeCrash) {
				await session.kill();
				await withRetry(() =>
					ctx.reply(
						"⚠️ Claude Code crashed and the session was reset. Please try again.",
					),
				);
			} else {
				const userMessage = formatUserError(
					error instanceof Error ? error : new Error(errorStr),
				);
				await withRetry(() =>
					ctx.reply(`❌ ${userMessage}`, {
						message_effect_id: effectFor(ctx, MESSAGE_EFFECTS.THUMBS_DOWN),
					}),
				);
			}
		} finally {
			typing.stop();
		}
		return;
	}

	await ctx.answerCallbackQuery({ text: "Unknown action" });
}
