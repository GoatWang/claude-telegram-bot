/**
 * Typing indicator utilities for Claude Telegram Bot.
 *
 * Provides a persistent typing indicator that loops until stopped.
 */

import type { Context } from "grammy";

// ============== Typing Indicator ==============

export interface TypingController {
	stop: () => void;
}

export function startTypingIndicator(ctx: Context): TypingController {
	let running = true;

	const loop = async () => {
		while (running) {
			try {
				await ctx.replyWithChatAction("typing");
			} catch (error) {
				// Stop loop if context is no longer valid
				if (
					String(error).includes("chat not found") ||
					String(error).includes("bot was blocked")
				) {
					running = false;
					return;
				}
				console.debug("Typing indicator failed:", error);
			}
			await Bun.sleep(4000);
		}
	};

	// Start the loop with proper error handling
	loop().catch((error) => {
		console.debug("Typing indicator loop error:", error);
	});

	return {
		stop: () => {
			running = false;
		},
	};
}
