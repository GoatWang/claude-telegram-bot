/**
 * Document handler for Claude Telegram Bot.
 *
 * Supports PDFs and text files with media group buffering.
 * PDF extraction uses pdftotext CLI (install via: brew install poppler)
 */

import type { Context } from "grammy";
import { ALLOWED_USERS, BOT_USERNAME, MESSAGE_EFFECTS } from "../../config";
import { isAuthorized, rateLimiter } from "../../security";
import {
	auditLogRateLimit,
	effectFor,
	handleUnauthorized,
	isBotMentioned,
} from "../../utils";
import { createMediaGroupBuffer } from "../media-group";
import {
	ARCHIVE_EXTENSIONS,
	MAX_FILE_SIZE,
	TEXT_EXTENSIONS,
} from "./constants";
import { downloadDocument, extractText, isArchive } from "./extractor";
import {
	processArchive,
	processDocumentPaths,
	processDocuments,
} from "./processor";

// Re-export everything for backward compatibility
export * from "./constants";
export * from "./extractor";
export * from "./processor";

// Create document-specific media group buffer
const documentBuffer = createMediaGroupBuffer({
	emoji: "📄",
	itemLabel: "document",
	itemLabelPlural: "documents",
});

/**
 * Handle incoming document messages.
 */
export async function handleDocument(ctx: Context): Promise<void> {
	const userId = ctx.from?.id;
	const username = ctx.from?.username || "unknown";
	const chatId = ctx.chat?.id;
	const doc = ctx.message?.document;
	const mediaGroupId = ctx.message?.media_group_id;

	if (!userId || !chatId || !doc) {
		return;
	}

	// 0. Group chat check - bot must be mentioned
	if (!(await isBotMentioned(ctx, BOT_USERNAME))) {
		return; // Silently ignore documents without mention in groups
	}

	// 1. Authorization check
	if (!isAuthorized(userId, ALLOWED_USERS)) {
		await handleUnauthorized(ctx, userId);
		return;
	}

	// 2. Check file size
	if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
		await ctx.reply("❌ File too large. Maximum size is 10MB.", {
			message_effect_id: effectFor(ctx, MESSAGE_EFFECTS.THUMBS_DOWN),
		});
		return;
	}

	// 3. Check file type
	const fileName = doc.file_name || "";
	const extension = `.${(fileName.split(".").pop() || "").toLowerCase()}`;
	const isPdf = doc.mime_type === "application/pdf" || extension === ".pdf";
	const isText =
		TEXT_EXTENSIONS.includes(extension) || doc.mime_type?.startsWith("text/");
	const isArchiveFile = isArchive(fileName);

	if (!isPdf && !isText && !isArchiveFile) {
		await ctx.reply(
			`❌ Unsupported file type: ${extension || doc.mime_type}\n\n` +
				`Supported: PDF, archives (${ARCHIVE_EXTENSIONS.join(
					", ",
				)}), ${TEXT_EXTENSIONS.join(", ")}`,
			{
				message_effect_id: effectFor(ctx, MESSAGE_EFFECTS.THUMBS_DOWN),
			},
		);
		return;
	}

	// 4. Download document
	let docPath: string;
	try {
		docPath = await downloadDocument(ctx);
	} catch (error) {
		console.error("Failed to download document:", error);
		await ctx.reply("❌ Failed to download document.", {
			message_effect_id: effectFor(ctx, MESSAGE_EFFECTS.THUMBS_DOWN),
		});
		return;
	}

	// 5. Archive files - process separately (no media group support)
	if (isArchiveFile) {
		console.log(`Received archive: ${fileName} from @${username}`);
		const [allowed, retryAfter] = rateLimiter.check(userId);
		if (!allowed && retryAfter !== undefined) {
			await auditLogRateLimit(userId, username, retryAfter);
			await ctx.reply(
				`⏳ Rate limited. Please wait ${retryAfter.toFixed(1)} seconds.`,
			);
			return;
		}

		await processArchive(
			ctx,
			docPath,
			fileName,
			ctx.message?.caption,
			userId,
			username,
			chatId,
		);
		return;
	}

	// 6. Single document - process immediately
	if (!mediaGroupId) {
		console.log(`Received document: ${fileName} from @${username}`);
		// Rate limit
		const [allowed, retryAfter] = rateLimiter.check(userId);
		if (!allowed && retryAfter !== undefined) {
			await auditLogRateLimit(userId, username, retryAfter);
			await ctx.reply(
				`⏳ Rate limited. Please wait ${retryAfter.toFixed(1)} seconds.`,
			);
			return;
		}

		try {
			const content = await extractText(docPath, doc.mime_type);
			await processDocuments(
				ctx,
				[{ path: docPath, name: fileName, content }],
				ctx.message?.caption,
				userId,
				username,
				chatId,
			);
		} catch (error) {
			console.error("Failed to extract document:", error);
			await ctx.reply(
				`❌ Failed to process document: ${String(error).slice(0, 100)}`,
			);
		}
		return;
	}

	// 7. Media group - buffer with timeout
	await documentBuffer.addToGroup(
		mediaGroupId,
		docPath,
		ctx,
		userId,
		username,
		processDocumentPaths,
	);
}
