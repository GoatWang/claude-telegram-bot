/**
 * Tests for command cache utility.
 */

import { describe, expect, test } from "bun:test";
import {
	getCacheStats,
	retrieveCommand,
	storeCommand,
} from "../utils/command-cache";

describe("command cache", () => {
	test("stores and retrieves short commands inline", () => {
		const userId = 12345;
		const command = "ls -la";

		const encoded = storeCommand(command, userId);
		expect(encoded).toStartWith("inline:");

		const retrieved = retrieveCommand(encoded, userId);
		expect(retrieved).toBe(command);
	});

	test("stores and retrieves long commands in cache", () => {
		const userId = 12345;
		const command = "a".repeat(100); // Long command

		const encoded = storeCommand(command, userId);
		expect(encoded).toStartWith("cache:");

		const retrieved = retrieveCommand(encoded, userId);
		expect(retrieved).toBe(command);
	});

	test("rejects commands with wrong user ID", () => {
		const userId = 12345;
		const wrongUserId = 99999;
		const command = "a".repeat(100);

		const encoded = storeCommand(command, userId);
		const retrieved = retrieveCommand(encoded, wrongUserId);

		expect(retrieved).toBeNull();
	});

	test("handles invalid encoded strings", () => {
		const userId = 12345;

		expect(retrieveCommand("invalid:xyz", userId)).toBeNull();
		expect(retrieveCommand("inline:!!!invalid", userId)).toBeNull();
		expect(retrieveCommand("cache:nonexistent", userId)).toBeNull();
	});

	test("supports legacy base64 format", () => {
		const userId = 12345;
		const command = "ls -la";
		const legacyEncoded = Buffer.from(command).toString("base64");

		const retrieved = retrieveCommand(legacyEncoded, userId);
		expect(retrieved).toBe(command);
	});

	test("provides cache statistics", () => {
		const stats1 = getCacheStats();
		expect(stats1.size).toBeGreaterThanOrEqual(0);

		// Add a cached command
		const userId = 12345;
		const command = "a".repeat(100);
		storeCommand(command, userId);

		const stats2 = getCacheStats();
		expect(stats2.size).toBeGreaterThan(stats1.size);
	});

	test("handles special characters in commands", () => {
		const userId = 12345;
		const command = 'echo "Hello $USER" && ls -la | grep test';

		const encoded = storeCommand(command, userId);
		const retrieved = retrieveCommand(encoded, userId);

		expect(retrieved).toBe(command);
	});

	test("handles unicode in commands", () => {
		const userId = 12345;
		const command = "echo '你好世界 🚀'";

		const encoded = storeCommand(command, userId);
		const retrieved = retrieveCommand(encoded, userId);

		expect(retrieved).toBe(command);
	});
});
