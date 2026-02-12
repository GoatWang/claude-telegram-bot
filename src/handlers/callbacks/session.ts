/**
 * Session-related callback handlers for Claude Telegram Bot.
 * Handles timeout, handoff, provider, restart, and bookmark callbacks.
 */

import { type Context, InlineKeyboard } from "grammy";
import { addBookmark, removeBookmark } from "../../bookmarks";
import {
	AGENT_PROVIDERS,
	type AgentProviderId,
	MESSAGE_EFFECTS,
} from "../../config";
import { sessionManager } from "../../session";
import { effectFor } from "../../utils";

/**
 * Handle timeout check response callbacks.
 * Format: timeout:continue or timeout:abort
 */
export async function handleTimeoutCallback(
	ctx: Context,
	callbackData: string,
): Promise<void> {
	const chatId = ctx.chat?.id;
	if (!chatId) return;
	const session = sessionManager.getSession(chatId);

	const action = callbackData.split(":")[1];

	if (action === "abort") {
		session.setTimeoutResponse("abort");
		await ctx.answerCallbackQuery({ text: "正在中斷..." });
		try {
			await ctx.editMessageText("🛑 已選擇中斷");
		} catch {
			// Message may have been deleted
		}
	} else if (action === "continue") {
		session.setTimeoutResponse("continue");
		await ctx.answerCallbackQuery({ text: "繼續執行" });
		try {
			await ctx.editMessageText("▶️ 繼續執行中...");
		} catch {
			// Message may have been deleted
		}
	} else {
		await ctx.answerCallbackQuery({ text: "Unknown action" });
	}
}

/**
 * Handle bookmark-related callbacks.
 */
export async function handleBookmarkCallback(
	ctx: Context,
	callbackData: string,
): Promise<void> {
	const chatId = ctx.chat?.id;
	if (!chatId) return;
	const session = sessionManager.getSession(chatId);

	const parts = callbackData.split(":");
	if (parts.length < 2) {
		await ctx.answerCallbackQuery({ text: "Invalid bookmark action" });
		return;
	}

	const action = parts[1];
	const path = parts.slice(2).join(":"); // Path may contain colons

	switch (action) {
		case "noop":
			await ctx.answerCallbackQuery({ text: "Already bookmarked" });
			break;

		case "add":
			if (addBookmark(path)) {
				await ctx.answerCallbackQuery({ text: "Bookmark added!" });
				try {
					await ctx.editMessageReplyMarkup({ reply_markup: undefined });
				} catch {
					// Message may have been deleted
				}
			} else {
				await ctx.answerCallbackQuery({ text: "Already bookmarked" });
			}
			break;

		case "new":
			session.setWorkingDir(path);
			await ctx.answerCallbackQuery({
				text: `Changed to: ${path.slice(-30)}`,
			});
			await ctx.reply(
				`📁 Changed to: <code>${path}</code>\n\nSession cleared. Next message starts fresh.`,
				{ parse_mode: "HTML" },
			);
			break;

		case "remove":
			if (removeBookmark(path)) {
				await ctx.answerCallbackQuery({ text: "Bookmark removed" });
				// Remove the row from the keyboard by editing message
				try {
					// Re-fetch bookmarks and rebuild keyboard
					const { loadBookmarks } = await import("../../bookmarks");
					const { InlineKeyboard } = await import("grammy");
					const bookmarks = loadBookmarks();

					if (bookmarks.length === 0) {
						await ctx.editMessageText(
							"📚 No bookmarks.\n\n" +
								"Use <code>/cd /path/to/dir</code> and click 'Add to bookmarks'.",
							{ parse_mode: "HTML" },
						);
					} else {
						let message = "📚 <b>Bookmarks</b>\n\n";
						const keyboard = new InlineKeyboard();
						for (const bookmark of bookmarks) {
							message += `📁 <code>${bookmark.path}</code>\n`;
							keyboard
								.text(`🆕 ${bookmark.name}`, `bookmark:new:${bookmark.path}`)
								.text("🗑️", `bookmark:remove:${bookmark.path}`)
								.row();
						}
						await ctx.editMessageText(message, {
							parse_mode: "HTML",
							reply_markup: keyboard,
						});
					}
				} catch {
					// Message may have been deleted
				}
			} else {
				await ctx.answerCallbackQuery({ text: "Bookmark not found" });
			}
			break;

		default:
			await ctx.answerCallbackQuery({ text: "Unknown action" });
	}
}

/**
 * Handle handoff callbacks.
 * Format: handoff:go or handoff:cancel
 */
export async function handleHandoffCallback(
	ctx: Context,
	callbackData: string,
): Promise<void> {
	const chatId = ctx.chat?.id;
	if (!chatId) return;
	const session = sessionManager.getSession(chatId);

	const action = callbackData.split(":")[1];

	if (action === "cancel") {
		await ctx.answerCallbackQuery({ text: "Cancelled" });
		try {
			await ctx.editMessageText("❌ Handoff cancelled");
		} catch {
			// Message may have been deleted
		}
		return;
	}

	if (action === "go") {
		const lastResponse = session.lastBotResponse;

		if (!lastResponse) {
			await ctx.answerCallbackQuery({ text: "No response to hand off" });
			return;
		}

		// Save the response as handoff context
		session.setHandoffContext(lastResponse);

		// Kill session
		await session.kill();

		await ctx.answerCallbackQuery({ text: "Session compressed" });
		try {
			await ctx.editMessageText(
				"✅ Session compressed.\n\n" +
					"Your next message will include the previous context summary.",
			);
		} catch {
			// Message may have been deleted
		}
		return;
	}

	await ctx.answerCallbackQuery({ text: "Unknown action" });
}

/**
 * Handle provider switch callbacks.
 * Format: provider:set:{name}
 */
export async function handleProviderCallback(
	ctx: Context,
	callbackData: string,
): Promise<void> {
	const chatId = ctx.chat?.id;
	if (!chatId) return;
	const session = sessionManager.getSession(chatId);

	const parts = callbackData.split(":");
	const action = parts[1];
	const provider = parts[2] as AgentProviderId | undefined;

	if (action !== "set" || !provider) {
		await ctx.answerCallbackQuery({ text: "Invalid provider action" });
		return;
	}

	if (!AGENT_PROVIDERS.includes(provider)) {
		await ctx.answerCallbackQuery({ text: "Unknown provider" });
		return;
	}

	const [success, message] = await session.setProvider(provider);
	if (!success) {
		await ctx.answerCallbackQuery({ text: message });
		return;
	}

	const current = session.currentProvider;
	const keyboard = new InlineKeyboard();
	for (const option of AGENT_PROVIDERS) {
		const label = option === current ? `✅ ${option}` : `⚪️ ${option}`;
		keyboard.text(label, `provider:set:${option}`).row();
	}

	try {
		await ctx.editMessageText(
			`🔀 <b>Provider Selection</b>\n\nCurrent: <b>${current}</b>\n\nChoose a provider below:`,
			{ parse_mode: "HTML", reply_markup: keyboard },
		);
	} catch {
		await ctx.reply(`🔀 ${message}`, { parse_mode: "HTML" });
	}

	await ctx.answerCallbackQuery({ text: `Switched to ${current}` });
}

/**
 * Handle restart confirmation callbacks.
 * Format: restart:confirm, restart:cancel, restart:start, restart:new, restart:status
 */
export async function handleRestartCallback(
	ctx: Context,
	callbackData: string,
): Promise<void> {
	const action = callbackData.split(":")[1];

	if (action === "cancel") {
		await ctx.answerCallbackQuery({ text: "已取消" });
		try {
			await ctx.editMessageText("❌ 重啟已取消");
		} catch {
			// Message may have been deleted
		}
		return;
	}

	if (action === "confirm") {
		await ctx.answerCallbackQuery({ text: "正在重啟..." });

		// Delete the confirmation message
		try {
			await ctx.deleteMessage();
		} catch {
			// Message may have been deleted
		}

		// Execute restart
		const { executeRestart } = await import("../commands");
		await executeRestart(ctx, ctx.chat?.id);
		return;
	}

	// Handle quick action buttons after restart
	if (action === "start") {
		await ctx.answerCallbackQuery({ text: "執行 /start" });
		const { handleStart } = await import("../commands");
		await handleStart(ctx);
		return;
	}

	if (action === "new") {
		await ctx.answerCallbackQuery({ text: "執行 /new" });
		const { handleNew } = await import("../commands");
		await handleNew(ctx);
		return;
	}

	if (action === "status") {
		await ctx.answerCallbackQuery({ text: "執行 /status" });
		const { handleStatus } = await import("../commands");
		await handleStatus(ctx);
		return;
	}

	await ctx.answerCallbackQuery({ text: "Unknown action" });
}
