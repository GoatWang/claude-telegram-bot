/**
 * Ask-user inline keyboard handling for Claude Telegram Bot.
 *
 * Handles the askuser:{request_id}:{option_index} callback pattern.
 */

import { unlinkSync } from "node:fs";
import type { Context } from "grammy";
import { MESSAGE_EFFECTS } from "../../config";
import { formatUserError } from "../../errors";
import { queryQueue } from "../../query-queue";
import { sessionManager } from "../../session";
import { withRetry } from "../../telegram-api";
import { auditLog, effectFor, startTypingIndicator } from "../../utils";
import { createStatusCallback, StreamingState } from "../streaming";

/**
 * Handle ask-user callback queries.
 * Format: askuser:{request_id}:{option_index}
 */
export async function handleAskUserCallback(
	ctx: Context,
	userId: number,
	username: string,
	chatId: number,
	callbackData: string,
): Promise<void> {
	const session = sessionManager.getSession(chatId);

	const parts = callbackData.split(":");
	const requestId = parts[1];
	const optionPart = parts[2];
	if (parts.length !== 3 || !requestId || !optionPart) {
		await ctx.answerCallbackQuery({ text: "Invalid callback data" });
		return;
	}

	const optionIndex = Number.parseInt(optionPart, 10);

	// 3. Load request file
	const requestFile = `/tmp/ask-user-${requestId}.json`;
	let requestData: {
		question: string;
		options: string[];
		status: string;
	};

	try {
		const file = Bun.file(requestFile);
		const text = await file.text();
		requestData = JSON.parse(text);
	} catch (error) {
		console.error(`Failed to load ask-user request ${requestId}:`, error);
		await ctx.answerCallbackQuery({ text: "Request expired or invalid" });
		return;
	}

	// 4. Get selected option
	if (optionIndex < 0 || optionIndex >= requestData.options.length) {
		await ctx.answerCallbackQuery({ text: "Invalid option" });
		return;
	}

	const selectedOption = requestData.options[optionIndex];
	if (!selectedOption) {
		await ctx.answerCallbackQuery({ text: "Invalid option" });
		return;
	}

	// 5. Update the message to show selection
	try {
		await ctx.editMessageText(`✓ ${selectedOption}`);
	} catch (error) {
		console.debug("Failed to edit callback message:", error);
	}

	// 6. Answer the callback
	await ctx.answerCallbackQuery({
		text: `Selected: ${selectedOption.slice(0, 50)}`,
	});

	// 7. Delete request file
	try {
		unlinkSync(requestFile);
	} catch (error) {
		console.debug("Failed to delete request file:", error);
	}

	// 8. Send the choice to Claude as a message
	const message = selectedOption;

	// Interrupt any running query - button responses are always immediate
	if (session.isRunning) {
		console.log("Interrupting current query for button response");
		await session.stop();
		// Small delay to ensure clean interruption
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	// Start typing
	const typing = startTypingIndicator(ctx);

	// Create streaming state
	const state = new StreamingState();
	const statusCallback = createStatusCallback(ctx, state, ctx.chat?.id);

	try {
		const response = await queryQueue.sendMessage(
			session,
			message,
			username,
			userId,
			statusCallback,
			chatId,
			ctx,
		);

		await auditLog(userId, username, "CALLBACK", message, response);
	} catch (error) {
		console.error("Error processing callback:", error);

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
			// Only show "Query stopped" if it was an explicit stop, not an interrupt from a new message
			const wasInterrupt = session.consumeInterruptFlag();
			if (!wasInterrupt) {
				await withRetry(() => ctx.reply("🛑 Query stopped."));
			}
		} else if (isClaudeCodeCrash) {
			await session.kill(); // Clear possibly corrupted session
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
}
