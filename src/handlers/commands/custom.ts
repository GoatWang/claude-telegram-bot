/**
 * Custom command handler factory for .claude/commands/ definitions.
 *
 * Creates a handler that replaces $ARGUMENTS in the command template
 * and sends to Claude via handleText (same pattern as handleSkill).
 */

import type { Context } from "grammy";
import { checkCommandAuth } from "./utils";

/**
 * Create a handler for a custom .claude/commands/ command.
 *
 * @param commandContent - The full .md file content (prompt template)
 * @returns An async handler compatible with bot.command()
 */
export function createCustomCommandHandler(
	commandContent: string,
): (ctx: Context) => Promise<void> {
	return async (ctx: Context): Promise<void> => {
		if (!(await checkCommandAuth(ctx))) return;

		const chatId = ctx.chat?.id;
		if (!chatId) return;

		// Extract arguments: everything after /command_name
		const text = ctx.message?.text || "";
		const args = text.replace(/^\/\S+\s*/, "").trim();

		// Replace $ARGUMENTS placeholder in the template
		const prompt = commandContent.replaceAll("$ARGUMENTS", args);

		// Send to Claude via handleText using the same fake-context pattern as handleSkill
		const { handleText } = await import("../text");
		const fakeCtx = {
			...ctx,
			message: {
				...ctx.message,
				text: prompt,
			},
		} as Context;

		await handleText(fakeCtx);
	};
}
