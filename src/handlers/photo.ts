/**
 * Photo message handler for Claude Telegram Bot.
 *
 * Supports single photos and media groups (albums) with 1s buffering.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Context } from "grammy";
import {
	ALLOWED_USERS,
	BOT_USERNAME,
	TEMP_DIR,
	WORKING_DIR,
} from "../config";
import { queryQueue } from "../query-queue";
import { isAuthorized, rateLimiter } from "../security";
import { sessionManager } from "../session";
import {
	auditLog,
	auditLogRateLimit,
	handleUnauthorized,
	isBotMentioned,
	startTypingIndicator,
} from "../utils";
import { cleanupTempFiles } from "../utils/temp-cleanup";
import { createMediaGroupBuffer, handleProcessingError } from "./media-group";
import { createStatusCallback, StreamingState } from "./streaming";

// Create photo-specific media group buffer
const photoBuffer = createMediaGroupBuffer({
	emoji: "📷",
	itemLabel: "photo",
	itemLabelPlural: "photos",
	showStatusMessages: false,
});

/**
 * Download a photo and return the local path.
 */
async function downloadPhoto(ctx: Context): Promise<string> {
	const photos = ctx.message?.photo;
	if (!photos || photos.length === 0) {
		throw new Error("No photo in message");
	}

	// Get the largest photo
	const file = await ctx.getFile();

	const timestamp = Date.now();
	const random = Math.random().toString(36).slice(2, 8);
	const photoPath = `${TEMP_DIR}/photo_${timestamp}_${random}.jpg`;

	// Download
	const response = await fetch(
		`https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`,
	);
	const buffer = await response.arrayBuffer();
	await Bun.write(photoPath, buffer);

	return photoPath;
}

/**
 * Save a photo from temp dir to a stable uploads directory under the bot's
 * main working directory. This keeps image references valid across later
 * messages, even if the session cwd changes.
 */
function savePhotoToPersistentDir(
	tempPath: string,
	chatId: number,
): { path: string; persistent: boolean } {
	try {
		const uploadsDir = join(WORKING_DIR, "uploads", `chat-${chatId}`);
		if (!existsSync(uploadsDir)) {
			mkdirSync(uploadsDir, { recursive: true });
		}
		const savedPath = join(uploadsDir, basename(tempPath));
		copyFileSync(tempPath, savedPath);
		return { path: savedPath, persistent: true };
	} catch (error) {
		console.warn("Failed to save photo to persistent uploads dir:", error);
		return { path: tempPath, persistent: false };
	}
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSlashCommandCaption(caption: string): string {
	let normalized = caption.trimStart();
	if (!normalized.startsWith("/") || !BOT_USERNAME) {
		return normalized;
	}

	const escapedUsername = escapeRegex(BOT_USERNAME);
	normalized = normalized.replace(
		new RegExp(`^(\\/\\S+?)@${escapedUsername}(?=\\s|$)`),
		"$1",
	);
	normalized = normalized.replace(
		new RegExp(`^(\\/\\S+)\\s+@${escapedUsername}(?=\\s|$)`),
		"$1",
	);

	return normalized;
}

/**
 * Build the Claude prompt for one or more saved photos.
 *
 * Slash-command captions must stay at the beginning of the prompt so Claude
 * can still resolve custom commands such as /add_task.
 */
export function buildPhotoPrompt(
	savedPaths: string[],
	caption: string | undefined,
): string {
	const isSlashCommand = caption?.trimStart().startsWith("/") ?? false;
	const normalizedCaption =
		isSlashCommand && caption ? normalizeSlashCommandCaption(caption) : caption;

	if (savedPaths.length === 1) {
		const photoContext = `[Photo saved to: ${savedPaths[0]}]`;
		if (!normalizedCaption) {
			return `Please analyze this image (saved to: ${savedPaths[0]})`;
		}
		return isSlashCommand
			? `${normalizedCaption}\n\n${photoContext}`
			: `${photoContext}\n\n${normalizedCaption}`;
	}

	const pathsList = savedPaths.map((p, i) => `${i + 1}. ${p}`).join("\n");
	const photosContext = `[Photos saved to:\n${pathsList}]`;
	if (!normalizedCaption) {
		return `Please analyze these ${savedPaths.length} images (saved to:\n${pathsList})`;
	}
	return isSlashCommand
		? `${normalizedCaption}\n\n${photosContext}`
		: `${photosContext}\n\n${normalizedCaption}`;
}

/**
 * Process photos with Claude.
 */
async function processPhotos(
	ctx: Context,
	photoPaths: string[],
	caption: string | undefined,
	userId: number,
	username: string,
	chatId: number,
): Promise<void> {
	// Get session for this chat
	const session = sessionManager.getSession(chatId);

	// Save photos outside temp storage so later turns can still access them.
	const savedPhotos = photoPaths.map((p) => savePhotoToPersistentDir(p, chatId));
	const savedPaths = savedPhotos.map((photo) => photo.path);
	const tempPathsToCleanup = photoPaths.filter(
		(_, index) => savedPhotos[index]?.persistent,
	);

	// Mark processing started
	const stopProcessing = session.startProcessing();

	// Build prompt with saved paths
	const prompt = buildPhotoPrompt(savedPaths, caption);

	// Start typing
	const typing = startTypingIndicator(ctx);

	// Create streaming state
	const state = new StreamingState();
	const statusCallback = createStatusCallback(ctx, state, chatId);

	try {
		const response = await queryQueue.sendMessage(
			session,
			prompt,
			username,
			userId,
			statusCallback,
			chatId,
			ctx,
		);

		await auditLog(userId, username, "PHOTO", prompt, response);
	} catch (error) {
		await handleProcessingError(ctx, error, state.toolMessages, chatId);
	} finally {
		stopProcessing();
		typing.stop();
		// Clean up temp files only after a persistent copy exists.
		cleanupTempFiles(tempPathsToCleanup);
	}
}

/**
 * Handle incoming photo messages.
 */
export async function handlePhoto(ctx: Context): Promise<void> {
	const userId = ctx.from?.id;
	const username = ctx.from?.username || "unknown";
	const chatId = ctx.chat?.id;
	const mediaGroupId = ctx.message?.media_group_id;

	if (!userId || !chatId) {
		return;
	}

	// 0. Group chat check - bot must be mentioned
	if (!(await isBotMentioned(ctx, BOT_USERNAME))) {
		return; // Silently ignore photos without mention in groups
	}

	// 1. Authorization check
	if (!isAuthorized(userId, ALLOWED_USERS)) {
		await handleUnauthorized(ctx, userId);
		return;
	}

	// 2. For single photos, rate limit early
	if (!mediaGroupId) {
		console.log(`Received photo from @${username}`);
		// Rate limit
		const [allowed, retryAfter] = rateLimiter.check(userId);
		if (!allowed && retryAfter !== undefined) {
			await auditLogRateLimit(userId, username, retryAfter);
			await ctx.reply(
				`⏳ Rate limited. Please wait ${retryAfter.toFixed(1)} seconds.`,
			);
			return;
		}
	}

	// 3. Download photo
	let photoPath: string;
	try {
		photoPath = await downloadPhoto(ctx);
	} catch (error) {
		console.error("Failed to download photo:", error);
		await ctx.reply("❌ Failed to download photo.");
		return;
	}

	// 4. Single photo - process immediately
	if (!mediaGroupId) {
		await processPhotos(
			ctx,
			[photoPath],
			ctx.message?.caption,
			userId,
			username,
			chatId,
		);
		return;
	}

	// 5. Media group - buffer with timeout
	if (!mediaGroupId) return; // TypeScript guard

	await photoBuffer.addToGroup(
		mediaGroupId,
		photoPath,
		ctx,
		userId,
		username,
		processPhotos,
	);
}
