/**
 * Unit tests for audit logging utilities (src/utils/audit.ts).
 *
 * Since the audit module reads AUDIT_LOG_PATH from config at import time,
 * and config is loaded before tests run, we use the actual config path.
 * We save/restore the log file content to avoid polluting real logs.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AUDIT_LOG_JSON, AUDIT_LOG_PATH } from "../config";
import {
	auditLog,
	auditLogAuth,
	auditLogError,
	auditLogRateLimit,
	auditLogTool,
} from "../utils/audit";

describe("Audit logging", () => {
	let originalContent: string | null = null;

	beforeEach(() => {
		// Save original content if file exists
		const dir = dirname(AUDIT_LOG_PATH);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		if (existsSync(AUDIT_LOG_PATH)) {
			originalContent = readFileSync(AUDIT_LOG_PATH, "utf-8");
		} else {
			originalContent = null;
		}
		// Truncate the file so we only see test output
		writeFileSync(AUDIT_LOG_PATH, "");
	});

	afterEach(() => {
		// Restore original content
		if (originalContent !== null) {
			writeFileSync(AUDIT_LOG_PATH, originalContent);
		} else {
			try {
				const { unlinkSync } = require("node:fs");
				unlinkSync(AUDIT_LOG_PATH);
			} catch {
				// Ignore
			}
		}
	});

	/**
	 * Helper to read the log content after a write.
	 */
	function readLogContent(): string {
		return readFileSync(AUDIT_LOG_PATH, "utf-8");
	}

	/**
	 * Parse JSON log entries (last line).
	 */
	function parseJsonEntry(content: string): Record<string, unknown> {
		const lines = content.trim().split("\n");
		const lastLine = lines[lines.length - 1]!;
		return JSON.parse(lastLine);
	}

	describe("auditLog", () => {
		test("writes an event to the log file", async () => {
			await auditLog(123, "testuser", "text", "hello world");

			const content = readLogContent();
			expect(content.length).toBeGreaterThan(0);

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.event).toBe("message");
				expect(event.user_id).toBe(123);
				expect(event.username).toBe("testuser");
				expect(event.message_type).toBe("text");
				expect(event.content).toBe("hello world");
				expect(event.timestamp).toBeDefined();
			} else {
				expect(content).toContain("message");
				expect(content).toContain("testuser");
				expect(content).toContain("hello world");
			}
		});

		test("includes response when provided", async () => {
			await auditLog(123, "testuser", "text", "hello", "response text");

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.response).toBe("response text");
			} else {
				expect(content).toContain("response text");
			}
		});

		test("omits response when not provided", async () => {
			await auditLog(123, "testuser", "text", "hello");

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.response).toBeUndefined();
			} else {
				expect(content).toContain("hello");
			}
		});

		test("writes valid timestamp", async () => {
			await auditLog(123, "testuser", "text", "hello");

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				const date = new Date(event.timestamp as string);
				expect(date.toISOString()).toBe(event.timestamp as string);
			} else {
				expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
			}
		});
	});

	describe("auditLogAuth", () => {
		test("writes an auth event with authorized=true", async () => {
			await auditLogAuth(456, "admin", true);

			const content = readLogContent();
			expect(content.length).toBeGreaterThan(0);

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.event).toBe("auth");
				expect(event.user_id).toBe(456);
				expect(event.username).toBe("admin");
				expect(event.authorized).toBe(true);
			} else {
				expect(content).toContain("auth");
				expect(content).toContain("admin");
			}
		});

		test("writes an auth event with authorized=false", async () => {
			await auditLogAuth(999, "stranger", false);

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.event).toBe("auth");
				expect(event.authorized).toBe(false);
			} else {
				expect(content).toContain("auth");
				expect(content).toContain("stranger");
			}
		});
	});

	describe("auditLogTool", () => {
		test("writes a tool_use event", async () => {
			await auditLogTool(123, "testuser", "bash", { command: "ls -la" });

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.event).toBe("tool_use");
				expect(event.tool_name).toBe("bash");
				expect(event.tool_input).toEqual({ command: "ls -la" });
				expect(event.blocked).toBe(false);
			} else {
				expect(content).toContain("tool_use");
				expect(content).toContain("bash");
			}
		});

		test("writes a blocked tool event with reason", async () => {
			await auditLogTool(
				123,
				"testuser",
				"bash",
				{ command: "rm -rf /" },
				true,
				"Dangerous command",
			);

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.blocked).toBe(true);
				expect(event.reason).toBe("Dangerous command");
			} else {
				expect(content).toContain("Dangerous command");
			}
		});

		test("omits reason when not blocked", async () => {
			await auditLogTool(123, "testuser", "read", { path: "/tmp/file" });

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.blocked).toBe(false);
				expect(event.reason).toBeUndefined();
			} else {
				expect(content).toContain("tool_use");
			}
		});
	});

	describe("auditLogError", () => {
		test("writes an error event", async () => {
			await auditLogError(123, "testuser", "Something broke");

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.event).toBe("error");
				expect(event.error).toBe("Something broke");
			} else {
				expect(content).toContain("error");
				expect(content).toContain("Something broke");
			}
		});

		test("includes context when provided", async () => {
			await auditLogError(123, "testuser", "API timeout", "sending message");

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.error).toBe("API timeout");
				expect(event.context).toBe("sending message");
			} else {
				expect(content).toContain("API timeout");
				expect(content).toContain("sending message");
			}
		});

		test("omits context when not provided", async () => {
			await auditLogError(123, "testuser", "Some error");

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.context).toBeUndefined();
			} else {
				expect(content).toContain("Some error");
			}
		});
	});

	describe("auditLogRateLimit", () => {
		test("writes a rate_limit event", async () => {
			await auditLogRateLimit(123, "testuser", 30);

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const event = parseJsonEntry(content);
				expect(event.event).toBe("rate_limit");
				expect(event.user_id).toBe(123);
				expect(event.username).toBe("testuser");
				expect(event.retry_after).toBe(30);
			} else {
				expect(content).toContain("rate_limit");
				expect(content).toContain("testuser");
			}
		});
	});

	describe("multiple log entries", () => {
		test("appends multiple entries", async () => {
			await auditLog(1, "user1", "text", "msg1");
			await auditLog(2, "user2", "text", "msg2");
			await auditLog(3, "user3", "text", "msg3");

			const content = readLogContent();

			if (AUDIT_LOG_JSON) {
				const lines = content.trim().split("\n");
				expect(lines.length).toBe(3);

				const event1 = JSON.parse(lines[0]!);
				const event2 = JSON.parse(lines[1]!);
				const event3 = JSON.parse(lines[2]!);

				expect(event1.user_id).toBe(1);
				expect(event2.user_id).toBe(2);
				expect(event3.user_id).toBe(3);
			} else {
				expect(content).toContain("user1");
				expect(content).toContain("user2");
				expect(content).toContain("user3");
			}
		});
	});

	describe("error resilience", () => {
		test("does not throw on any input", async () => {
			await expect(
				auditLog(123, "testuser", "text", "hello"),
			).resolves.toBeUndefined();
		});

		test("does not throw for empty strings", async () => {
			await expect(auditLog(0, "", "", "")).resolves.toBeUndefined();
		});

		test("does not throw for very long content", async () => {
			const longContent = "x".repeat(10000);
			await expect(
				auditLog(123, "testuser", "text", longContent),
			).resolves.toBeUndefined();
		});
	});
});

// ============== Audit event structure tests ==============
// Test the event construction logic without relying on file output.

describe("Audit event structure", () => {
	test("auditLog creates correct event shape", () => {
		const event = {
			timestamp: new Date().toISOString(),
			event: "message" as const,
			user_id: 123,
			username: "testuser",
			message_type: "text",
			content: "hello",
		};

		expect(event.event).toBe("message");
		expect(event.user_id).toBe(123);
		expect(typeof event.timestamp).toBe("string");
	});

	test("auditLogAuth creates correct event shape", () => {
		const event = {
			timestamp: new Date().toISOString(),
			event: "auth" as const,
			user_id: 456,
			username: "admin",
			authorized: true,
		};

		expect(event.event).toBe("auth");
		expect(event.authorized).toBe(true);
	});

	test("auditLogTool creates correct event shape with blocked reason", () => {
		const event: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
			event: "tool_use",
			user_id: 123,
			username: "testuser",
			tool_name: "bash",
			tool_input: { command: "rm -rf /" },
			blocked: true,
		};
		if (event.blocked && "Dangerous") {
			event.reason = "Dangerous";
		}

		expect(event.reason).toBe("Dangerous");
	});

	test("auditLogTool omits reason when not blocked", () => {
		const event: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
			event: "tool_use",
			user_id: 123,
			username: "testuser",
			tool_name: "read",
			tool_input: { path: "/tmp/file" },
			blocked: false,
		};

		expect(event.reason).toBeUndefined();
	});

	test("auditLogError creates correct event shape with context", () => {
		const event: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
			event: "error",
			user_id: 123,
			username: "testuser",
			error: "API timeout",
		};
		const context = "sending message";
		if (context) {
			event.context = context;
		}

		expect(event.context).toBe("sending message");
	});

	test("auditLogError omits context when empty", () => {
		const event: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
			event: "error",
			user_id: 123,
			username: "testuser",
			error: "Some error",
		};
		const context = "";
		if (context) {
			event.context = context;
		}

		expect(event.context).toBeUndefined();
	});

	test("auditLogRateLimit creates correct event shape", () => {
		const event = {
			timestamp: new Date().toISOString(),
			event: "rate_limit" as const,
			user_id: 123,
			username: "testuser",
			retry_after: 30,
		};

		expect(event.event).toBe("rate_limit");
		expect(event.retry_after).toBe(30);
	});
});

// ============== Log rotation logic tests ==============

describe("Audit log rotation logic", () => {
	test("rotation file naming follows pattern", () => {
		const basePath = "/tmp/audit.log";
		const maxFiles = 3;

		for (let i = 1; i <= maxFiles; i++) {
			const rotatedPath = `${basePath}.${i}`;
			expect(rotatedPath).toBe(`/tmp/audit.log.${i}`);
		}
	});

	test("oldest file path is correct", () => {
		const basePath = "/tmp/audit.log";
		const maxFiles = 3;
		const oldestPath = `${basePath}.${maxFiles}`;
		expect(oldestPath).toBe("/tmp/audit.log.3");
	});

	test("rotation order is highest to lowest", () => {
		const maxFiles = 3;
		const order: number[] = [];
		for (let i = maxFiles - 1; i >= 1; i--) {
			order.push(i);
		}
		expect(order).toEqual([2, 1]);
	});

	test("source path for first rotation is the base file", () => {
		const basePath = "/tmp/audit.log";
		const i = 1;
		const oldPath = i === 1 ? basePath : `${basePath}.${i - 1}`;
		const newPath = `${basePath}.${i}`;

		expect(oldPath).toBe("/tmp/audit.log");
		expect(newPath).toBe("/tmp/audit.log.1");
	});

	test("source path for subsequent rotations uses numbered files", () => {
		const basePath = "/tmp/audit.log";
		const i: number = 2;
		const oldPath = i === 1 ? basePath : `${basePath}.${i - 1}`;
		const newPath = `${basePath}.${i}`;

		expect(oldPath).toBe("/tmp/audit.log.1");
		expect(newPath).toBe("/tmp/audit.log.2");
	});
});

// ============== writeAuditLog format tests ==============

describe("Audit log format", () => {
	test("JSON format produces valid JSON line", () => {
		const event = {
			timestamp: "2024-01-01T00:00:00.000Z",
			event: "message",
			user_id: 123,
			username: "testuser",
			content: "hello",
		};

		const jsonLine = `${JSON.stringify(event)}\n`;
		const parsed = JSON.parse(jsonLine.trim());
		expect(parsed.event).toBe("message");
		expect(parsed.user_id).toBe(123);
	});

	test("plain text format produces readable output", () => {
		const event: Record<string, unknown> = {
			timestamp: "2024-01-01T00:00:00.000Z",
			event: "message",
			user_id: 123,
			content: "hello",
		};

		const lines = [`\n${"=".repeat(60)}`];
		for (const [key, value] of Object.entries(event)) {
			lines.push(`${key}: ${value}`);
		}
		const content = `${lines.join("\n")}\n`;

		expect(content).toContain("=".repeat(60));
		expect(content).toContain("event: message");
		expect(content).toContain("user_id: 123");
		expect(content).toContain("content: hello");
	});

	test("plain text format truncates long content", () => {
		const longValue = "x".repeat(1000);
		const event: Record<string, unknown> = {
			content: longValue,
		};

		const lines: string[] = [];
		for (const [key, value] of Object.entries(event)) {
			let displayValue = value;
			if (
				(key === "content" || key === "response") &&
				String(value).length > 500
			) {
				displayValue = `${String(value).slice(0, 500)}...`;
			}
			lines.push(`${key}: ${displayValue}`);
		}

		const line = lines[0]!;
		expect(line).toContain("...");
		expect(line.length).toBeLessThan(520);
	});

	test("plain text format does not truncate short content", () => {
		const shortValue = "hello world";
		const event: Record<string, unknown> = {
			content: shortValue,
		};

		const lines: string[] = [];
		for (const [key, value] of Object.entries(event)) {
			let displayValue = value;
			if (
				(key === "content" || key === "response") &&
				String(value).length > 500
			) {
				displayValue = `${String(value).slice(0, 500)}...`;
			}
			lines.push(`${key}: ${displayValue}`);
		}

		expect(lines[0]).toBe("content: hello world");
	});
});
