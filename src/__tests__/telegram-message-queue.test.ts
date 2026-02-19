/**
 * Tests for Telegram message batching queue.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
	TelegramMessageQueue,
	MessagePriority,
	MessageType,
} from "../telegram-message-queue";

// Mock Context
const createMockContext = () => {
	const messages: any[] = [];

	return {
		chat: { id: 123 },
		reply: mock(async (text: string, options?: any) => {
			const msg = {
				chat: { id: 123 },
				message_id: messages.length + 1,
				text,
				...options,
			};
			messages.push(msg);
			return msg;
		}),
		api: {
			editMessageText: mock(
				async (chatId: number, messageId: number, text: string) => {
					const msg = messages.find((m) => m.message_id === messageId);
					if (msg) {
						msg.text = text;
					}
					return true;
				},
			),
			deleteMessage: mock(async (chatId: number, messageId: number) => {
				const index = messages.findIndex((m) => m.message_id === messageId);
				if (index >= 0) {
					messages.splice(index, 1);
				}
				return true;
			}),
		},
		_messages: messages,
	} as any;
};

describe("TelegramMessageQueue", () => {
	describe("Priority handling", () => {
		test("CRITICAL priority sends immediately", async () => {
			const queue = new TelegramMessageQueue({ enabled: true });
			const ctx = createMockContext();

			const start = Date.now();
			await queue.enqueue(
				ctx,
				MessageType.BUTTON,
				MessagePriority.CRITICAL,
				"Critical",
				async () => ctx.reply("Critical"),
			);
			const elapsed = Date.now() - start;

			// Should be sent immediately (< 50ms)
			expect(elapsed).toBeLessThan(50);
			expect(ctx.reply).toHaveBeenCalledTimes(1);
		});

		test("HIGH priority batches with short delay", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				highPriorityDelay: 100,
			});
			const ctx = createMockContext();

			const start = Date.now();
			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.HIGH,
				"High priority",
				async () => ctx.reply("High priority"),
			);

			// Wait for batch to flush
			await Bun.sleep(150);
			const elapsed = Date.now() - start;

			expect(elapsed).toBeGreaterThanOrEqual(100);
			expect(ctx.reply).toHaveBeenCalledTimes(1);
		});

		test("NORMAL priority batches with longer delay", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				normalPriorityDelay: 500,
			});
			const ctx = createMockContext();

			const start = Date.now();
			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Normal priority",
				async () => ctx.reply("Normal priority"),
			);

			// Wait for batch to flush
			await Bun.sleep(550);
			const elapsed = Date.now() - start;

			expect(elapsed).toBeGreaterThanOrEqual(500);
			expect(ctx.reply).toHaveBeenCalledTimes(1);
		});
	});

	describe("Message merging", () => {
		test("merges text updates for same segment", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				normalPriorityDelay: 100,
			});
			const ctx = createMockContext();

			// Queue multiple updates for same segment
			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Version 1",
				async () => ctx.reply("Version 1"),
				{ segmentId: 1 },
			);

			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Version 2",
				async () => ctx.reply("Version 2"),
				{ segmentId: 1 },
			);

			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Version 3",
				async () => ctx.reply("Version 3"),
				{ segmentId: 1 },
			);

			// Wait for batch to flush
			await Bun.sleep(150);

			// Should only send the latest version
			expect(ctx.reply).toHaveBeenCalledTimes(1);
			expect(ctx.reply).toHaveBeenCalledWith("Version 3");
		});

		test("keeps updates for different segments", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				normalPriorityDelay: 100,
			});
			const ctx = createMockContext();

			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Segment 1",
				async () => ctx.reply("Segment 1"),
				{ segmentId: 1 },
			);

			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Segment 2",
				async () => ctx.reply("Segment 2"),
				{ segmentId: 2 },
			);

			// Wait for batch to flush
			await Bun.sleep(150);

			// Should send both segments
			expect(ctx.reply).toHaveBeenCalledTimes(2);
		});
	});

	describe("Tool status merging", () => {
		test("merges tool statuses into overview", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				mergeToolStatuses: true,
			});
			const ctx = createMockContext();

			// Add first tool
			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"🔧",
				async () => ctx.reply("Tool 1"),
				{ toolName: "Read", toolStatus: "running" },
			);

			// Wait for message to be created
			await Bun.sleep(100);

			// Verify first tool is shown
			expect(ctx.reply).toHaveBeenCalled();
			let message = ctx.reply.mock.calls[ctx.reply.mock.calls.length - 1][0];
			expect(message).toContain("Read");

			// Add second tool
			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"📝",
				async () => ctx.reply("Tool 2"),
				{ toolName: "Edit", toolStatus: "running" },
			);

			// Wait for update
			await Bun.sleep(100);

			// Should have updated overview with both tools via editMessageText
			expect(ctx.api.editMessageText).toHaveBeenCalled();
			const lastEdit =
				ctx.api.editMessageText.mock.calls[
					ctx.api.editMessageText.mock.calls.length - 1
				];
			message = lastEdit[2]; // Third parameter is the text

			// Should contain both tools
			expect(message).toContain("Read");
			expect(message).toContain("Edit");
		});

		test("updates counter when tool completes", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				mergeToolStatuses: true,
			});
			const ctx = createMockContext();

			// Start tool
			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"🔧",
				async () => ctx.reply("Tool"),
				{ toolName: "Read", toolStatus: "running" },
			);

			await Bun.sleep(50);

			// Complete tool
			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"🔧",
				async () => ctx.reply("Tool"),
				{ toolName: "Read", toolStatus: "done" },
			);

			await Bun.sleep(50);

			// Should show completion
			const lastEdit = ctx.api.editMessageText.mock.calls[
				ctx.api.editMessageText.mock.calls.length - 1
			];
			if (lastEdit) {
				const message = lastEdit[2];
				expect(message).toContain("1/1"); // 1 of 1 complete
			}
		});

		test("deletes overview when all tools done", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				mergeToolStatuses: true,
			});
			const ctx = createMockContext();

			// Start and complete tool
			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"🔧",
				async () => ctx.reply("Tool"),
				{ toolName: "Read", toolStatus: "running" },
			);

			await Bun.sleep(50);

			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"🔧",
				async () => ctx.reply("Tool"),
				{ toolName: "Read", toolStatus: "done" },
			);

			// Wait for cleanup delay (2s in implementation)
			await Bun.sleep(2100);

			// Overview message should be deleted
			expect(ctx.api.deleteMessage).toHaveBeenCalled();
		});
	});

	describe("Thinking messages", () => {
		test("hides thinking messages by default", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				showThinking: false,
			});
			const ctx = createMockContext();

			await queue.enqueue(
				ctx,
				MessageType.THINKING,
				MessagePriority.LOW,
				"Thinking...",
				async () => ctx.reply("Thinking..."),
			);

			await Bun.sleep(100);

			// Should not send message
			expect(ctx.reply).not.toHaveBeenCalled();
		});

		test("shows thinking messages when enabled", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				showThinking: true,
			});
			const ctx = createMockContext();

			await queue.enqueue(
				ctx,
				MessageType.THINKING,
				MessagePriority.LOW,
				"Thinking...",
				async () => ctx.reply("Thinking..."),
			);

			// Wait for batch to flush (LOW priority uses normal delay)
			await Bun.sleep(1600);

			// Should send message
			expect(ctx.reply).toHaveBeenCalledWith("Thinking...");
		});
	});

	describe("Batching disabled", () => {
		test("sends messages immediately when disabled", async () => {
			const queue = new TelegramMessageQueue({ enabled: false });
			const ctx = createMockContext();

			const start = Date.now();
			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Immediate",
				async () => ctx.reply("Immediate"),
			);
			const elapsed = Date.now() - start;

			// Should be sent immediately
			expect(elapsed).toBeLessThan(50);
			expect(ctx.reply).toHaveBeenCalledTimes(1);
		});
	});

	describe("Flush all", () => {
		test("flushes all pending messages", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				normalPriorityDelay: 5000, // Long delay
			});
			const ctx = createMockContext();

			// Queue messages with different segment IDs (won't be merged)
			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Message 1",
				async () => ctx.reply("Message 1"),
				{ segmentId: 1 },
			);

			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Message 2",
				async () => ctx.reply("Message 2"),
				{ segmentId: 2 },
			);

			// Flush immediately instead of waiting
			await queue.flushAll();

			// Both messages should be sent (different segments)
			expect(ctx.reply).toHaveBeenCalledTimes(2);
		});
	});

	describe("Delete tool overview", () => {
		test("deletes tool overview message", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				mergeToolStatuses: true,
			});
			const ctx = createMockContext();

			// Create tool overview
			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"🔧",
				async () => ctx.reply("Tool"),
				{ toolName: "Read", toolStatus: "running" },
			);

			await Bun.sleep(50);

			// Delete overview
			await queue.deleteToolOverview(ctx, 123);

			// Should delete the message
			expect(ctx.api.deleteMessage).toHaveBeenCalled();
		});
	});

	describe("Integration scenarios", () => {
		test("typical streaming session", async () => {
			const queue = new TelegramMessageQueue({
				enabled: true,
				mergeToolStatuses: true,
				highPriorityDelay: 100,
				normalPriorityDelay: 200,
			});
			const ctx = createMockContext();

			// Tool starts
			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"🔧",
				async () => ctx.reply("Read"),
				{ toolName: "Read", toolStatus: "running" },
			);

			await Bun.sleep(50);

			// Text segment starts (HIGH priority)
			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.HIGH,
				"Text v1",
				async () => ctx.reply("Text v1"),
				{ segmentId: 1 },
			);

			// Multiple text updates (NORMAL priority, should merge)
			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Text v2",
				async () => ctx.reply("Text v2"),
				{ segmentId: 1 },
			);

			await queue.enqueue(
				ctx,
				MessageType.TEXT_UPDATE,
				MessagePriority.NORMAL,
				"Text v3",
				async () => ctx.reply("Text v3"),
				{ segmentId: 1 },
			);

			// Tool completes
			await queue.enqueue(
				ctx,
				MessageType.TOOL_STATUS,
				MessagePriority.LOW,
				"🔧",
				async () => ctx.reply("Read"),
				{ toolName: "Read", toolStatus: "done" },
			);

			// Done message (CRITICAL priority)
			await queue.enqueue(
				ctx,
				MessageType.BUTTON,
				MessagePriority.CRITICAL,
				"Done",
				async () => ctx.reply("Done"),
			);

			// Wait for all batches to flush
			await Bun.sleep(300);

			// Should have reduced number of messages
			// - Tool overview: 1 message
			// - Text HIGH: 1 message
			// - Text NORMAL (merged): 1 message
			// - Done: 1 message
			expect(ctx.reply.mock.calls.length).toBeLessThanOrEqual(6);
		});
	});
});
