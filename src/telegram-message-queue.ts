/**
 * Message batching queue for Telegram API calls.
 *
 * Reduces API calls by:
 * 1. Batching similar messages (e.g., multiple tool status updates)
 * 2. Debouncing frequent updates (e.g., streaming text edits)
 * 3. Merging tool statuses into a single overview message
 * 4. Respecting priority (critical messages bypass batching)
 */

import type { Context } from "grammy";
import type { Message } from "grammy/types";
import { telegramRateLimiter } from "./telegram-rate-limiter";
import { withRetry } from "./telegram-api";

/**
 * Message priority levels.
 */
export enum MessagePriority {
	/** Send immediately (user interactions, critical info) */
	CRITICAL = 0,
	/** Batch with 100ms delay (new text segments, tool starts) */
	HIGH = 1,
	/** Batch with 3s delay (streaming updates) */
	NORMAL = 2,
	/** Merge with other low-priority messages (tool spinners) */
	LOW = 3,
}

/**
 * Types of messages for intelligent merging.
 */
export enum MessageType {
	TOOL_STATUS = "tool_status",
	TEXT_UPDATE = "text_update",
	THINKING = "thinking",
	BUTTON = "button",
	NOTIFICATION = "notification",
}

interface QueuedMessage {
	type: MessageType;
	priority: MessagePriority;
	chatId: number;
	content: string;
	sendFn: () => Promise<Message>;
	metadata?: {
		segmentId?: number;
		toolName?: string;
		toolStatus?: "running" | "done";
		messageId?: number; // For edits
	};
	enqueuedAt: number;
}

interface ToolStatusUpdate {
	toolName: string;
	status: "running" | "done";
	emoji: string;
}

/**
 * Batching configuration.
 */
interface BatchConfig {
	/** Enable batching (default: true) */
	enabled: boolean;
	/** Delay for HIGH priority messages in ms (default: 100) */
	highPriorityDelay: number;
	/** Delay for NORMAL priority messages in ms (default: 3000) */
	normalPriorityDelay: number;
	/** Merge tool statuses into overview (default: true) */
	mergeToolStatuses: boolean;
	/** Show thinking messages (default: false) */
	showThinking: boolean;
}

const DEFAULT_CONFIG: BatchConfig = {
	enabled: true,
	highPriorityDelay: 100, // 100ms - barely noticeable
	normalPriorityDelay: 1500, // 1.5s instead of 3s - more responsive
	mergeToolStatuses: true,
	showThinking: false,
};

/**
 * Message batching queue with intelligent merging.
 */
export class TelegramMessageQueue {
	private config: BatchConfig;
	private queues = new Map<MessagePriority, QueuedMessage[]>();
	private timers = new Map<MessagePriority, ReturnType<typeof setTimeout>>();

	// Tool status tracking for merging
	private activeTools = new Map<number, ToolStatusUpdate[]>(); // chatId -> tools
	private toolOverviewMessages = new Map<number, Message>(); // chatId -> message
	private toolSpinners = new Map<number, ReturnType<typeof setInterval>>(); // chatId -> spinner interval

	constructor(config?: Partial<BatchConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };

		// Initialize queues for each priority
		for (const priority of Object.values(MessagePriority)) {
			if (typeof priority === "number") {
				this.queues.set(priority, []);
			}
		}
	}

	/**
	 * Enqueue a message for sending.
	 */
	async enqueue(
		ctx: Context,
		type: MessageType,
		priority: MessagePriority,
		content: string,
		sendFn: () => Promise<Message>,
		metadata?: QueuedMessage["metadata"],
	): Promise<void> {
		const chatId = ctx.chat?.id;
		if (!chatId) {
			console.warn("Cannot enqueue message: no chat ID");
			return;
		}

		// Skip thinking messages if disabled
		if (type === MessageType.THINKING && !this.config.showThinking) {
			return;
		}

		// Handle tool status specially if merging is enabled
		if (
			type === MessageType.TOOL_STATUS &&
			this.config.mergeToolStatuses &&
			metadata?.toolName
		) {
			await this.updateToolOverview(
				ctx,
				chatId,
				metadata.toolName,
				metadata.toolStatus || "running",
				content,
			);
			return;
		}

		const message: QueuedMessage = {
			type,
			priority,
			chatId,
			content,
			sendFn,
			metadata,
			enqueuedAt: Date.now(),
		};

		// CRITICAL priority: send immediately
		if (priority === MessagePriority.CRITICAL || !this.config.enabled) {
			await this.sendMessage(message);
			return;
		}

		// Add to appropriate queue
		const queue = this.queues.get(priority)!;
		queue.push(message);

		// Schedule flush if not already scheduled
		this.scheduleFlush(priority);
	}

	/**
	 * Update tool overview message with current tool statuses.
	 *
	 * IMPORTANT: This method updates IMMEDIATELY (not batched) to provide
	 * real-time feedback and avoid feeling "stuck".
	 */
	private async updateToolOverview(
		ctx: Context,
		chatId: number,
		toolName: string,
		status: "running" | "done",
		emoji: string,
	): Promise<void> {
		// Get or initialize tool list for this chat
		let tools = this.activeTools.get(chatId) || [];

		// Update or add tool status
		const existingIdx = tools.findIndex((t) => t.toolName === toolName);
		if (existingIdx >= 0) {
			tools[existingIdx]! = { toolName, status, emoji };
		} else {
			tools.push({ toolName, status, emoji });
		}

		// Remove completed tools after a delay
		if (status === "done") {
			setTimeout(() => {
				tools = tools.filter((t) => t.toolName !== toolName);
				this.activeTools.set(chatId, tools);
				// Update overview after removing completed tool
				this.updateToolOverviewMessage(ctx, chatId, tools).catch(() => {});
			}, 2000);
		}

		this.activeTools.set(chatId, tools);

		// Update the overview message immediately
		await this.updateToolOverviewMessage(ctx, chatId, tools);
	}

	/**
	 * Update the tool overview message (separated for reuse).
	 */
	private async updateToolOverviewMessage(
		ctx: Context,
		chatId: number,
		tools: ToolStatusUpdate[],
		spinnerFrame?: string,
	): Promise<void> {
		// Format overview message
		const running = tools.filter((t) => t.status === "running");
		const done = tools.filter((t) => t.status === "done");

		if (running.length === 0 && done.length === 0) {
			// Delete overview message if no active tools
			const msg = this.toolOverviewMessages.get(chatId);
			if (msg) {
				try {
					await ctx.api.deleteMessage(chatId, msg.message_id);
				} catch {
					// Message may already be deleted
				}
				this.toolOverviewMessages.delete(chatId);
			}
			// Stop spinner
			this.stopToolSpinner(chatId);
			return;
		}

		// Add spinner to show activity
		const spinner = spinnerFrame || "⚙️";
		let overview = `${spinner} <b>Tools</b>\n`;

		if (running.length > 0) {
			overview += running.map((t) => `${t.emoji} ${t.toolName}...`).join("\n");
		}

		if (done.length > 0) {
			overview +=
				(running.length > 0 ? "\n" : "") +
				done.map((t) => `✓ ${t.toolName}`).join(", ");
		}

		overview += `\n<i>${done.length}/${tools.length} complete</i>`;

		// Create or update overview message
		const existingMsg = this.toolOverviewMessages.get(chatId);

		// IMMEDIATE update (not rate-limited aggressively) for better UX
		await telegramRateLimiter.acquireSlot(chatId);

		if (existingMsg) {
			// Update existing message
			try {
				await withRetry(() =>
					ctx.api.editMessageText(
						chatId,
						existingMsg.message_id,
						overview,
						{ parse_mode: "HTML" },
					),
				);
			} catch {
				// Message may have been deleted, create new one
				const newMsg = await withRetry(() =>
					ctx.reply(overview, { parse_mode: "HTML" }),
				);
				this.toolOverviewMessages.set(chatId, newMsg);
			}
		} else {
			// Create new overview message
			const newMsg = await withRetry(() =>
				ctx.reply(overview, { parse_mode: "HTML" }),
			);
			this.toolOverviewMessages.set(chatId, newMsg);

			// Start spinner animation if there are running tools
			if (running.length > 0) {
				this.startToolSpinner(ctx, chatId);
			}
		}
	}

	/**
	 * Start spinner animation for tool overview.
	 */
	private startToolSpinner(ctx: Context, chatId: number): void {
		// Stop existing spinner if any
		this.stopToolSpinner(chatId);

		const spinnerFrames = ["⚙️", "🔧", "⚡", "💫"];
		let frameIndex = 0;

		const interval = setInterval(async () => {
			const tools = this.activeTools.get(chatId);
			if (!tools || tools.filter((t) => t.status === "running").length === 0) {
				this.stopToolSpinner(chatId);
				return;
			}

			frameIndex = (frameIndex + 1) % spinnerFrames.length;
			await this.updateToolOverviewMessage(
				ctx,
				chatId,
				tools,
				spinnerFrames[frameIndex],
			).catch(() => {
				// Stop on error
				this.stopToolSpinner(chatId);
			});
		}, 1000); // Update spinner every 1 second

		this.toolSpinners.set(chatId, interval);
	}

	/**
	 * Stop spinner animation for tool overview.
	 */
	private stopToolSpinner(chatId: number): void {
		const interval = this.toolSpinners.get(chatId);
		if (interval) {
			clearInterval(interval);
			this.toolSpinners.delete(chatId);
		}
	}

	/**
	 * Schedule a flush for the given priority queue.
	 */
	private scheduleFlush(priority: MessagePriority): void {
		// Don't schedule if already scheduled
		if (this.timers.has(priority)) {
			return;
		}

		const delay = this.getDelayForPriority(priority);

		const timer = setTimeout(() => {
			this.flush(priority);
		}, delay);

		this.timers.set(priority, timer);
	}

	/**
	 * Get batching delay for a priority level.
	 */
	private getDelayForPriority(priority: MessagePriority): number {
		switch (priority) {
			case MessagePriority.HIGH:
				return this.config.highPriorityDelay;
			case MessagePriority.NORMAL:
			case MessagePriority.LOW:
				return this.config.normalPriorityDelay;
			default:
				return 0;
		}
	}

	/**
	 * Flush all messages in a priority queue.
	 */
	private async flush(priority: MessagePriority): Promise<void> {
		const timer = this.timers.get(priority);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(priority);
		}

		const queue = this.queues.get(priority)!;
		if (queue.length === 0) {
			return;
		}

		// Get all messages and clear queue
		const messages = [...queue];
		queue.length = 0;

		// Merge similar messages by chat and segment
		const merged = this.mergeMessages(messages);

		// Send all messages
		for (const msg of merged) {
			await this.sendMessage(msg);
		}
	}

	/**
	 * Merge similar messages to reduce API calls.
	 */
	private mergeMessages(messages: QueuedMessage[]): QueuedMessage[] {
		// Group by chat and segment
		const groups = new Map<string, QueuedMessage[]>();

		for (const msg of messages) {
			const key = `${msg.chatId}-${msg.type}-${msg.metadata?.segmentId ?? "none"}`;
			const group = groups.get(key) || [];
			group.push(msg);
			groups.set(key, group);
		}

		// Keep only the latest message from each group
		const merged: QueuedMessage[] = [];

		for (const group of Array.from(groups.values())) {
			// For text updates, keep only the latest
			if (group[0]!.type === MessageType.TEXT_UPDATE) {
				merged.push(group[group.length - 1]!);
			} else {
				// For other types, keep all (already deduplicated by key)
				merged.push(...group);
			}
		}

		return merged;
	}

	/**
	 * Send a single message, respecting rate limits.
	 */
	private async sendMessage(msg: QueuedMessage): Promise<void> {
		// Respect global rate limit
		await telegramRateLimiter.acquireSlot(msg.chatId);

		try {
			await msg.sendFn();
		} catch (error) {
			console.error("Failed to send queued message:", error);
		}
	}

	/**
	 * Flush all queues immediately (for shutdown).
	 */
	async flushAll(): Promise<void> {
		for (const priority of Array.from(this.queues.keys())) {
			await this.flush(priority);
		}
	}

	/**
	 * Delete tool overview message for a chat (when done).
	 */
	async deleteToolOverview(ctx: Context, chatId: number): Promise<void> {
		// Stop spinner first
		this.stopToolSpinner(chatId);

		const msg = this.toolOverviewMessages.get(chatId);
		if (msg) {
			try {
				await ctx.api.deleteMessage(chatId, msg.message_id);
			} catch {
				// Ignore errors
			}
			this.toolOverviewMessages.delete(chatId);
		}
		this.activeTools.delete(chatId);
	}
}

// Global singleton
export const telegramMessageQueue = new TelegramMessageQueue({
	enabled: process.env.MESSAGE_BATCHING_ENABLED !== "false",
	mergeToolStatuses: process.env.MERGE_TOOL_STATUSES !== "false",
	showThinking: process.env.SHOW_THINKING_MESSAGES === "true",
});
