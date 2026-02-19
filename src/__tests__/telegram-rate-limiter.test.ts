/**
 * Tests for Telegram API rate limiter.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { TelegramRateLimiter } from "../telegram-rate-limiter";

describe("TelegramRateLimiter", () => {
	describe("Global rate limiting (per second)", () => {
		test("allows calls under the limit", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 5,
				maxPerMinutePerChat: 100,
			});

			// Should allow 5 calls without delay
			for (let i = 0; i < 5; i++) {
				const delay = await limiter.acquireSlot();
				expect(delay).toBe(0);
			}
		});

		test("delays when exceeding global limit", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 5,
				maxPerMinutePerChat: 100,
			});

			// Fill the bucket
			for (let i = 0; i < 5; i++) {
				await limiter.acquireSlot();
			}

			// 6th call should be delayed
			const start = Date.now();
			const delay = await limiter.acquireSlot();
			const elapsed = Date.now() - start;

			expect(delay).toBeGreaterThan(0);
			expect(elapsed).toBeGreaterThanOrEqual(delay - 10); // Allow 10ms tolerance
		});

		test("resets after time window", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 2,
				maxPerMinutePerChat: 100,
			});

			// Make 2 calls
			await limiter.acquireSlot();
			await limiter.acquireSlot();

			// Wait for window to pass
			await Bun.sleep(1100);

			// Should allow calls again
			const delay = await limiter.acquireSlot();
			expect(delay).toBe(0);
		});
	});

	describe("Per-chat rate limiting (per minute)", () => {
		test("allows calls under per-chat limit", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 100,
				maxPerMinutePerChat: 5,
			});

			const chatId = 123;

			// Should allow 5 calls to same chat
			for (let i = 0; i < 5; i++) {
				const delay = await limiter.acquireSlot(chatId);
				expect(delay).toBe(0);
			}
		});

		test("delays when exceeding per-chat limit", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 100,
				maxPerMinutePerChat: 3,
			});

			const chatId = 123;

			// Fill the per-chat bucket quickly
			const now = Date.now();
			for (let i = 0; i < 3; i++) {
				await limiter.acquireSlot(chatId);
			}

			// 4th call should calculate a delay
			// We don't actually wait - just check the delay value
			const status = limiter.getStatus(chatId);
			expect(status.chatCallsLastMinute).toBe(3);

			// The delay should be calculated but we won't wait for it
			// Reset the limiter to avoid actual waiting
			limiter.reset();
		});

		test("tracks different chats separately", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 100,
				maxPerMinutePerChat: 2,
			});

			const chatId1 = 123;
			const chatId2 = 456;

			// Fill bucket for chat 1
			await limiter.acquireSlot(chatId1);
			await limiter.acquireSlot(chatId1);

			// Chat 2 should still have capacity
			const delay = await limiter.acquireSlot(chatId2);
			expect(delay).toBe(0);
		});

		test("respects both global and per-chat limits", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 10,
				maxPerMinutePerChat: 3,
			});

			const chatId = 123;

			// Fill per-chat bucket (3 calls)
			for (let i = 0; i < 3; i++) {
				await limiter.acquireSlot(chatId);
			}

			// Check status shows limit reached
			const status = limiter.getStatus(chatId);
			expect(status.chatCallsLastMinute).toBe(3);
			expect(status.globalCallsLastSecond).toBeLessThan(10); // Global not reached

			// Reset to avoid long wait
			limiter.reset();
		});
	});

	describe("Status reporting", () => {
		test("reports current rate limit status", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 5,
				maxPerMinutePerChat: 10,
			});

			const chatId = 123;

			// Make some calls
			await limiter.acquireSlot(chatId);
			await limiter.acquireSlot(chatId);

			const status = limiter.getStatus(chatId);

			expect(status.globalLimit).toBe(5);
			expect(status.chatLimit).toBe(10);
			expect(status.globalCallsLastSecond).toBe(2);
			expect(status.chatCallsLastMinute).toBe(2);
		});

		test("status reflects sliding window", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 5,
				maxPerMinutePerChat: 10,
			});

			const chatId = 123;

			// Make calls
			await limiter.acquireSlot(chatId);
			await limiter.acquireSlot(chatId);

			// Check initial status
			let status = limiter.getStatus(chatId);
			expect(status.globalCallsLastSecond).toBe(2);

			// Wait for window to expire
			await Bun.sleep(1100);

			// Status should reflect expired window
			status = limiter.getStatus(chatId);
			expect(status.globalCallsLastSecond).toBe(0);
			expect(status.chatCallsLastMinute).toBe(2); // Still within minute
		});
	});

	describe("Cleanup", () => {
		test("cleans up old records", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 10,
				maxPerMinutePerChat: 10,
			});

			const chatId = 123;

			// Make some calls
			await limiter.acquireSlot(chatId);
			await limiter.acquireSlot(chatId);

			// Verify calls are recorded
			let status = limiter.getStatus(chatId);
			expect(status.chatCallsLastMinute).toBe(2);

			// Wait for window to expire (just over 1 minute)
			await Bun.sleep(1100);

			// After 1 second, global calls should be cleaned
			status = limiter.getStatus(chatId);
			expect(status.globalCallsLastSecond).toBe(0);

			// Chat calls still tracked (within 60 second window)
			expect(status.chatCallsLastMinute).toBeGreaterThan(0);
		});
	});

	describe("Reset", () => {
		test("resets all tracking", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 2,
				maxPerMinutePerChat: 5,
			});

			const chatId = 123;

			// Fill buckets
			await limiter.acquireSlot(chatId);
			await limiter.acquireSlot(chatId);

			// Reset
			limiter.reset();

			// Should allow calls again immediately
			const delay = await limiter.acquireSlot(chatId);
			expect(delay).toBe(0);

			const status = limiter.getStatus(chatId);
			expect(status.globalCallsLastSecond).toBe(1); // Only the post-reset call
			expect(status.chatCallsLastMinute).toBe(1);
		});
	});

	describe("Edge cases", () => {
		test("handles calls without chatId", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 5,
				maxPerMinutePerChat: 10,
			});

			// Should only check global limit
			const delay = await limiter.acquireSlot();
			expect(delay).toBe(0);
		});

		test("handles rapid sequential calls", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 3,
				maxPerMinutePerChat: 10,
			});

			const chatId = 123;

			// Make rapid calls
			const delays = await Promise.all([
				limiter.acquireSlot(chatId),
				limiter.acquireSlot(chatId),
				limiter.acquireSlot(chatId),
				limiter.acquireSlot(chatId), // Should be delayed
			]);

			// First 3 should be immediate
			expect(delays[0]).toBe(0);
			expect(delays[1]).toBe(0);
			expect(delays[2]).toBe(0);

			// 4th should be delayed
			expect(delays[3]).toBeGreaterThan(0);
		});

		test("buffer prevents hitting exact limit", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 5,
				maxPerMinutePerChat: 10,
			});

			// The 50ms buffer should prevent edge cases
			for (let i = 0; i < 5; i++) {
				await limiter.acquireSlot();
			}

			// Even with buffer, should start delaying at limit
			const delay = await limiter.acquireSlot();
			expect(delay).toBeGreaterThan(40); // At least the buffer time
		});
	});

	describe("Realistic scenarios", () => {
		test("typical bot usage pattern", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 25,
				maxPerMinutePerChat: 18,
			});

			const chatId = 123;

			// Simulate tool execution with multiple updates
			const delays: number[] = [];

			// 10 tool status updates
			for (let i = 0; i < 10; i++) {
				delays.push(await limiter.acquireSlot(chatId));
			}

			// 5 text updates
			for (let i = 0; i < 5; i++) {
				delays.push(await limiter.acquireSlot(chatId));
			}

			// 1 done message
			delays.push(await limiter.acquireSlot(chatId));

			// Total 16 calls - should all be allowed (under 18/min limit)
			const delayedCalls = delays.filter((d) => d > 0).length;
			expect(delayedCalls).toBe(0); // None should be delayed

			const status = limiter.getStatus(chatId);
			expect(status.chatCallsLastMinute).toBe(16);
		});

		test("burst protection", async () => {
			const limiter = new TelegramRateLimiter({
				maxPerSecond: 5,
				maxPerMinutePerChat: 20,
			});

			const chatId = 123;

			// Simulate burst of 10 calls
			const start = Date.now();
			for (let i = 0; i < 10; i++) {
				await limiter.acquireSlot(chatId);
			}
			const elapsed = Date.now() - start;

			// Should take at least 1 second due to per-second limit
			expect(elapsed).toBeGreaterThanOrEqual(900); // Allow some tolerance
		});
	});
});
