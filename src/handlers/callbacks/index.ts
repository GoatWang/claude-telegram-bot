/**
 * Callback query handler for Claude Telegram Bot.
 *
 * Handles inline keyboard button presses (ask_user MCP integration, bookmarks, file sending).
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../../config";
import { isAuthorized } from "../../security";
import { sendPrivateMessage } from "../../utils";
import { handleActionCallback } from "./action";
import { handleAskUserCallback } from "./ask-user";
import { handleBranchCallback, handleDiffCallback, handleMergeCallback, handleSendFileCallback } from "./git";
import { handlePendingCallback } from "./pending";
import {
	handleBookmarkCallback,
	handleHandoffCallback,
	handleProviderCallback,
	handleRestartCallback,
	handleTimeoutCallback,
} from "./session";
import { handleShellCallback } from "./shell";
import { handleVoiceCallback } from "./voice";

/**
 * Handle callback queries from inline keyboards.
 */
export async function handleCallback(ctx: Context): Promise<void> {
	const userId = ctx.from?.id;
	const username = ctx.from?.username || "unknown";
	const chatId = ctx.chat?.id;
	const callbackData = ctx.callbackQuery?.data;

	if (!userId || !chatId || !callbackData) {
		await ctx.answerCallbackQuery();
		return;
	}

	// 1. Authorization check
	if (!isAuthorized(userId, ALLOWED_USERS)) {
		await ctx.answerCallbackQuery({ text: "Unauthorized" });
		// In groups, also send private message
		const chat = ctx.chat;
		if (chat && chat.type !== "private") {
			await sendPrivateMessage(
				ctx,
				userId,
				"⚠️ 您未被授權使用此機器人。\n\n如需存取權限，請聯繫機器人擁有者。",
			);
		}
		return;
	}

	// 2. Handle voice confirmation callbacks
	if (callbackData.startsWith("voice:")) {
		await handleVoiceCallback(ctx, userId, username, chatId, callbackData);
		return;
	}

	// 3. Handle shell command confirmation
	if (callbackData.startsWith("shell:")) {
		await handleShellCallback(ctx, userId, username, callbackData);
		return;
	}

	// 2a. Handle timeout response callbacks
	if (callbackData.startsWith("timeout:")) {
		await handleTimeoutCallback(ctx, callbackData);
		return;
	}

	// 2b. Handle pending message callbacks
	if (callbackData.startsWith("pending:")) {
		await handlePendingCallback(ctx, userId, username, callbackData);
		return;
	}

	// 2c. Handle action callbacks (undo/test/commit)
	if (callbackData.startsWith("action:")) {
		await handleActionCallback(ctx, userId, username, callbackData);
		return;
	}

	// 2d. Handle bookmark callbacks
	if (callbackData.startsWith("bookmark:")) {
		await handleBookmarkCallback(ctx, callbackData);
		return;
	}

	// 2e. Handle file sending callbacks
	if (callbackData.startsWith("sendfile:")) {
		await handleSendFileCallback(ctx, callbackData);
		return;
	}

	// 2f. Handle handoff callbacks
	if (callbackData.startsWith("handoff:")) {
		await handleHandoffCallback(ctx, callbackData);
		return;
	}

	// 2g. Handle provider callbacks
	if (callbackData.startsWith("provider:")) {
		await handleProviderCallback(ctx, callbackData);
		return;
	}

	// 2h. Handle branch callbacks
	if (callbackData.startsWith("branch:")) {
		await handleBranchCallback(ctx, userId, chatId, callbackData);
		return;
	}

	// 2i. Handle merge callbacks
	if (callbackData.startsWith("merge:")) {
		await handleMergeCallback(ctx, userId, username, callbackData);
		return;
	}

	// 2j. Handle diff callbacks
	if (callbackData.startsWith("diff:")) {
		await handleDiffCallback(ctx, userId, username, callbackData);
		return;
	}

	// 2k. Handle restart callbacks
	if (callbackData.startsWith("restart:")) {
		await handleRestartCallback(ctx, callbackData);
		return;
	}

	// 3. Parse callback data: askuser:{request_id}:{option_index}
	if (!callbackData.startsWith("askuser:")) {
		await ctx.answerCallbackQuery();
		return;
	}

	await handleAskUserCallback(ctx, userId, username, chatId, callbackData);
}

// Re-export all submodules for backward compatibility
export { handleAskUserCallback } from "./ask-user";
export { handleShellCallback } from "./shell";
export { handlePendingCallback } from "./pending";
export { handleActionCallback } from "./action";
export {
	handleTimeoutCallback,
	handleHandoffCallback,
	handleProviderCallback,
	handleRestartCallback,
	handleBookmarkCallback,
} from "./session";
export {
	handleBranchCallback,
	handleMergeCallback,
	handleDiffCallback,
	handleSendFileCallback,
} from "./git";
export { handleVoiceCallback } from "./voice";
