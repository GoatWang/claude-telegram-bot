/**
 * Unit tests for Telegram API utilities.
 */

import { describe, expect, test } from "bun:test";
import {
	createPollingRunnerOptions,
	createTelegramRetryTransformer,
	isTransientTelegramError,
	sanitizeTelegramError,
	TelegramApiError,
	withRetry,
} from "../telegram-api";

describe("withRetry", () => {
	test("succeeds on first attempt", async () => {
		let attempts = 0;
		const result = await withRetry(async () => {
			attempts++;
			return "success";
		});
		expect(result).toBe("success");
		expect(attempts).toBe(1);
	});

	test("retries on transient failure then succeeds", async () => {
		let attempts = 0;
		const result = await withRetry(
			async () => {
				attempts++;
				if (attempts < 3) {
					throw new Error("Too Many Requests: retry after 1");
				}
				return "success";
			},
			{ maxRetries: 3, baseDelay: 10 },
		);
		expect(result).toBe("success");
		expect(attempts).toBe(3);
	});

	test("throws after max retries", async () => {
		let attempts = 0;
		await expect(
			withRetry(
				async () => {
					attempts++;
					throw new Error("Too Many Requests: retry after 1");
				},
				{ maxRetries: 2, baseDelay: 10 },
			),
		).rejects.toThrow();
		expect(attempts).toBe(2);
	});

	test("does not retry non-transient errors", async () => {
		let attempts = 0;
		await expect(
			withRetry(
				async () => {
					attempts++;
					throw new Error("Bad Request: message not found");
				},
				{ maxRetries: 3, baseDelay: 10 },
			),
		).rejects.toThrow("Bad Request");
		expect(attempts).toBe(1);
	});
});

describe("TelegramApiError", () => {
	test("isTransient returns true for rate limit errors", () => {
		const error = new TelegramApiError("Too Many Requests: retry after 5", 429);
		expect(error.isTransient).toBe(true);
		expect(error.retryAfter).toBe(5);
	});

	test("isTransient returns true for network errors", () => {
		const error = new TelegramApiError("ETIMEDOUT", 0);
		expect(error.isTransient).toBe(true);
	});

	test("isTransient returns false for bad request", () => {
		const error = new TelegramApiError("Bad Request: message not found", 400);
		expect(error.isTransient).toBe(false);
	});
});

describe("isTransientTelegramError", () => {
	test("returns true for Bun timeout errors", () => {
		const error = new Error("TimeoutError: The operation timed out.");
		expect(isTransientTelegramError(error)).toBe(true);
	});

	test("returns true for ECONNRESET", () => {
		const error = new Error("socket closed unexpectedly ECONNRESET");
		expect(isTransientTelegramError(error)).toBe(true);
	});
});

describe("createTelegramRetryTransformer", () => {
	test("retries transient sendMessage failures", async () => {
		let attempts = 0;
		const transformer = createTelegramRetryTransformer();

		const result = await transformer(
			(async () => {
				attempts++;
				if (attempts < 3) {
					throw new Error("ECONNRESET");
				}
				return { ok: true, result: "sent" };
			}) as any,
			"sendMessage",
			{} as never,
		);

		expect(result).toEqual({ ok: true, result: "sent" } as any);
		expect(attempts).toBe(3);
	});

	test("does not retry non-transient getUpdates failures", async () => {
		let attempts = 0;
		const transformer = createTelegramRetryTransformer();

		await expect(
			transformer(
				(async () => {
					attempts++;
					throw new Error("401 Unauthorized");
				}) as any,
				"getUpdates",
				{} as never,
			),
		).rejects.toThrow("401 Unauthorized");

		expect(attempts).toBe(1);
	});
});

describe("createPollingRunnerOptions", () => {
	test("silences runner error dumps and enables long-polling retries", () => {
		const options = createPollingRunnerOptions();

		expect(options.runner.silent).toBe(true);
		expect(options.runner.fetch?.timeout).toBe(30);
		expect(options.runner.retryInterval).toBe(1000);
		expect(options.runner.maxRetryTime).toBe(15 * 60 * 60 * 1000);
	});
});

describe("sanitizeTelegramError", () => {
	test("redacts bot tokens from runner errors", () => {
		process.env.TELEGRAM_BOT_TOKEN = "123:secret-token";

		const sanitized = sanitizeTelegramError(
			new Error(
				"request failed path: https://api.telegram.org/bot123:secret-token/getUpdates",
			),
		);

		expect(sanitized).not.toContain("secret-token");
		expect(sanitized).toContain("bot<redacted>");
	});
});
