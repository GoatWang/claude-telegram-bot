/**
 * Document processing orchestration.
 *
 * High-level functions that coordinate extraction, session management,
 * and Claude interaction for documents and archives.
 */

import type { Context } from "grammy";
import { MESSAGE_EFFECTS } from "../../config";
import { queryQueue } from "../../query-queue";
import { sessionManager } from "../../session";
import { auditLog, effectFor, startTypingIndicator } from "../../utils";
import { cleanupTempFile, cleanupTempFiles } from "../../utils/temp-cleanup";
import { handleProcessingError } from "../media-group";
import { createStatusCallback, StreamingState } from "../streaming";
import {
	extractArchive,
	extractArchiveContent,
	extractText,
} from "./extractor";

/**
 * Process an archive file.
 */
export async function processArchive(
	ctx: Context,
	archivePath: string,
	fileName: string,
	caption: string | undefined,
	userId: number,
	username: string,
	chatId: number,
): Promise<void> {
	// Get session for this chat
	const session = sessionManager.getSession(chatId);

	const stopProcessing = session.startProcessing();
	const typing = startTypingIndicator(ctx);

	// Show extraction progress
	const statusMsg = await ctx.reply(`📦 Extracting <b>${fileName}</b>...`, {
		parse_mode: "HTML",
	});

	try {
		// Extract archive
		console.log(`Extracting archive: ${fileName}`);
		const extractDir = await extractArchive(archivePath, fileName);
		const { tree, contents } = await extractArchiveContent(extractDir);
		console.log(`Extracted: ${tree.length} files, ${contents.length} readable`);

		// Update status
		await ctx.api.editMessageText(
			statusMsg.chat.id,
			statusMsg.message_id,
			`📦 Extracted <b>${fileName}</b>: ${tree.length} files, ${contents.length} readable`,
			{ parse_mode: "HTML" },
		);

		// Build prompt
		const treeStr = tree.length > 0 ? tree.join("\n") : "(empty)";
		const contentsStr =
			contents.length > 0
				? contents.map((c) => `--- ${c.name} ---\n${c.content}`).join("\n\n")
				: "(no readable text files)";

		const prompt = caption
			? `Archive: ${fileName}\n\nFile tree (${tree.length} files):\n${treeStr}\n\nExtracted contents:\n${contentsStr}\n\n---\n\n${caption}`
			: `Please analyze this archive (${fileName}):\n\nFile tree (${tree.length} files):\n${treeStr}\n\nExtracted contents:\n${contentsStr}`;

		// Create streaming state
		const state = new StreamingState();
		const statusCallback = createStatusCallback(ctx, state, ctx.chat?.id);

		const response = await queryQueue.sendMessage(
			session,
			prompt,
			username,
			userId,
			statusCallback,
			chatId,
			ctx,
		);

		await auditLog(
			userId,
			username,
			"ARCHIVE",
			`[${fileName}] ${caption || ""}`,
			response,
		);

		// Cleanup
		await Bun.$`rm -rf ${extractDir}`.quiet();

		// Delete status message
		try {
			await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
		} catch {
			// Ignore deletion errors
		}
	} catch (error) {
		console.error("Archive processing error:", error);
		// Delete status message on error
		try {
			await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
		} catch {
			// Ignore
		}
		await ctx.reply(
			`❌ Failed to process archive: ${String(error).slice(0, 100)}`,
		);
	} finally {
		stopProcessing();
		typing.stop();
		// Clean up archive file
		cleanupTempFile(archivePath);
	}
}

/**
 * Process documents with Claude.
 */
export async function processDocuments(
	ctx: Context,
	documents: Array<{ path: string; name: string; content: string }>,
	caption: string | undefined,
	userId: number,
	username: string,
	chatId: number,
): Promise<void> {
	// Get session for this chat
	const session = sessionManager.getSession(chatId);

	// Mark processing started
	const stopProcessing = session.startProcessing();

	// Build prompt
	let prompt: string;
	if (documents.length === 1 && documents[0]) {
		const doc = documents[0];
		prompt = caption
			? `Document: ${doc.name}\n\nContent:\n${doc.content}\n\n---\n\n${caption}`
			: `Please analyze this document (${doc.name}):\n\n${doc.content}`;
	} else {
		const docList = documents
			.map((d, i) => `--- Document ${i + 1}: ${d.name} ---\n${d.content}`)
			.join("\n\n");
		prompt = caption
			? `${documents.length} Documents:\n\n${docList}\n\n---\n\n${caption}`
			: `Please analyze these ${documents.length} documents:\n\n${docList}`;
	}

	// Start typing
	const typing = startTypingIndicator(ctx);

	// Create streaming state
	const state = new StreamingState();
	const statusCallback = createStatusCallback(ctx, state, ctx.chat?.id);

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

		await auditLog(
			userId,
			username,
			"DOCUMENT",
			`[${documents.length} docs] ${caption || ""}`,
			response,
		);
	} catch (error) {
		await handleProcessingError(ctx, error, state.toolMessages, chatId);
	} finally {
		stopProcessing();
		typing.stop();
		// Clean up temp files
		cleanupTempFiles(documents.map((d) => d.path));
	}
}

/**
 * Process document paths by extracting text and calling processDocuments.
 */
export async function processDocumentPaths(
	ctx: Context,
	paths: string[],
	caption: string | undefined,
	userId: number,
	username: string,
	chatId: number,
): Promise<void> {
	// Extract text from all documents
	const documents: Array<{ path: string; name: string; content: string }> = [];

	for (const path of paths) {
		try {
			const name = path.split("/").pop() || "document";
			const content = await extractText(path);
			documents.push({ path, name, content });
		} catch (error) {
			console.error(`Failed to extract ${path}:`, error);
		}
	}

	if (documents.length === 0) {
		await ctx.reply("❌ Failed to extract any documents.", {
			message_effect_id: effectFor(ctx, MESSAGE_EFFECTS.THUMBS_DOWN),
		});
		return;
	}

	await processDocuments(ctx, documents, caption, userId, username, chatId);
}
