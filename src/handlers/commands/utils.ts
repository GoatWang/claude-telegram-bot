/**
 * Shared utilities for command handlers.
 */

import type { Context } from "grammy";
import { ALLOWED_USERS, BOT_USERNAME } from "../../config";
import { isAuthorized } from "../../security";
import { handleUnauthorized, isBotMentioned } from "../../utils";

export const CALLBACK_DATA_LIMIT = 64;
export const BRANCH_LIST_LIMIT = Number.parseInt(
	process.env.BRANCH_LIST_LIMIT || "40",
	10,
);

/**
 * Check if command should be handled (group mention check + authorization).
 * Returns true if should continue, false if should return early.
 */
export async function checkCommandAuth(ctx: Context): Promise<boolean> {
	const userId = ctx.from?.id;

	// Group chat check - bot must be mentioned for commands
	if (!(await isBotMentioned(ctx, BOT_USERNAME))) {
		return false; // Silently ignore in groups without mention
	}

	// Authorization check
	if (!userId || !isAuthorized(userId, ALLOWED_USERS)) {
		if (userId) {
			await handleUnauthorized(ctx, userId);
		}
		return false;
	}

	return true;
}
