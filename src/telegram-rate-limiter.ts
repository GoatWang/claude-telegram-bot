/**
 * Global Telegram API rate limiter.
 *
 * Prevents hitting Telegram Bot API limits:
 * - 30 messages per second (across all chats)
 * - 20 messages per minute per chat
 * - editMessageText counts toward these limits
 *
 * Uses a token bucket algorithm with separate tracking for:
 * - Global requests per second
 * - Per-chat requests per minute
 */

export interface RateLimitConfig {
	/** Maximum requests per second (global, default: 25 to stay under 30) */
	maxPerSecond?: number;
	/** Maximum requests per minute per chat (default: 18 to stay under 20) */
	maxPerMinutePerChat?: number;
	/** Enable debug logging (default: false) */
	debug?: boolean;
}

interface CallRecord {
	timestamp: number;
	chatId?: number;
}

const DEFAULT_CONFIG: Required<RateLimitConfig> = {
	maxPerSecond: 25,
	maxPerMinutePerChat: 18,
	debug: false,
};

/**
 * Global rate limiter for Telegram API calls.
 *
 * Tracks all API calls and enforces limits using sliding window.
 */
export class TelegramRateLimiter {
	private config: Required<RateLimitConfig>;
	private calls: CallRecord[] = [];
	private chatCalls = new Map<number, number[]>(); // chatId -> timestamps

	constructor(config?: RateLimitConfig) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Wait if necessary to respect rate limits before making a call.
	 *
	 * @param chatId - Optional chat ID for per-chat rate limiting
	 * @returns Delay in milliseconds (0 if no delay needed)
	 */
	async acquireSlot(chatId?: number): Promise<number> {
		const now = Date.now();

		// Clean up old records (older than 1 minute)
		this.cleanup(now);

		// Check global per-second limit
		const globalDelay = this.checkGlobalLimit(now);

		// Check per-chat per-minute limit if chatId provided
		const chatDelay = chatId ? this.checkChatLimit(chatId, now) : 0;

		// Use the longer delay
		const delay = Math.max(globalDelay, chatDelay);

		if (delay > 0) {
			if (this.config.debug) {
				console.debug(
					`Rate limit: waiting ${delay}ms (global: ${globalDelay}ms, chat ${chatId}: ${chatDelay}ms)`,
				);
			}
			await Bun.sleep(delay);
		}

		// Record this call
		this.recordCall(now + delay, chatId);

		return delay;
	}

	/**
	 * Check global per-second limit using sliding window.
	 */
	private checkGlobalLimit(now: number): number {
		const oneSecondAgo = now - 1000;
		const recentCalls = this.calls.filter((c) => c.timestamp > oneSecondAgo);

		if (recentCalls.length >= this.config.maxPerSecond) {
			// Calculate how long to wait for oldest call to expire
			const oldestInWindow = recentCalls[0]!;
			const delay = oldestInWindow.timestamp + 1000 - now + 50; // +50ms buffer
			return Math.max(0, delay);
		}

		return 0;
	}

	/**
	 * Check per-chat per-minute limit using sliding window.
	 */
	private checkChatLimit(chatId: number, now: number): number {
		const oneMinuteAgo = now - 60000;
		const chatCalls = this.chatCalls.get(chatId) || [];

		// Filter to calls within last minute
		const recentCalls = chatCalls.filter((t) => t > oneMinuteAgo);

		if (recentCalls.length >= this.config.maxPerMinutePerChat) {
			// Calculate how long to wait for oldest call to expire
			const oldestInWindow = recentCalls[0]!;
			const delay = oldestInWindow + 60000 - now + 50; // +50ms buffer
			return Math.max(0, delay);
		}

		return 0;
	}

	/**
	 * Record a successful API call.
	 */
	private recordCall(timestamp: number, chatId?: number): void {
		this.calls.push({ timestamp, chatId });

		if (chatId) {
			const chatCalls = this.chatCalls.get(chatId) || [];
			chatCalls.push(timestamp);
			this.chatCalls.set(chatId, chatCalls);
		}
	}

	/**
	 * Clean up old call records (older than 1 minute).
	 */
	private cleanup(now: number): void {
		const oneMinuteAgo = now - 60000;

		// Clean global calls
		this.calls = this.calls.filter((c) => c.timestamp > oneMinuteAgo);

		// Clean per-chat calls
		for (const [chatId, timestamps] of Array.from(this.chatCalls.entries())) {
			const recent = timestamps.filter((t) => t > oneMinuteAgo);
			if (recent.length === 0) {
				this.chatCalls.delete(chatId);
			} else {
				this.chatCalls.set(chatId, recent);
			}
		}
	}

	/**
	 * Get current rate limit status (for debugging/monitoring).
	 */
	getStatus(chatId?: number): {
		globalCallsLastSecond: number;
		chatCallsLastMinute: number;
		globalLimit: number;
		chatLimit: number;
	} {
		const now = Date.now();
		const oneSecondAgo = now - 1000;
		const oneMinuteAgo = now - 60000;

		const globalCallsLastSecond = this.calls.filter(
			(c) => c.timestamp > oneSecondAgo,
		).length;

		const chatCallsLastMinute = chatId
			? (this.chatCalls.get(chatId) || []).filter((t) => t > oneMinuteAgo)
					.length
			: 0;

		return {
			globalCallsLastSecond,
			chatCallsLastMinute,
			globalLimit: this.config.maxPerSecond,
			chatLimit: this.config.maxPerMinutePerChat,
		};
	}

	/**
	 * Reset all rate limit tracking (for testing).
	 */
	reset(): void {
		this.calls = [];
		this.chatCalls.clear();
	}
}

// Global singleton instance
export const telegramRateLimiter = new TelegramRateLimiter({
	debug: process.env.TELEGRAM_RATE_LIMIT_DEBUG === "true",
});
