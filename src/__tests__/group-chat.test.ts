/**
 * Unit tests for group chat helpers (src/utils/group-chat.ts).
 */

import { describe, expect, mock, test, beforeEach } from "bun:test";
import {
	checkInterrupt,
	effectFor,
	isBotMentioned,
	sendPrivateMessage,
	handleUnauthorized,
} from "../utils/group-chat";

// ============== Mock Context Helpers ==============

/**
 * Create a minimal mock Context object for testing.
 */
function createMockContext(
	overrides: {
		chatType?: "private" | "group" | "supergroup" | "channel";
		chatId?: number;
		messageText?: string;
		entities?: Array<{
			type: string;
			offset: number;
			length: number;
		}>;
		replyToFrom?: { username: string };
		memberCount?: number;
		memberCountError?: boolean;
	} = {},
): any {
	const {
		chatType = "private",
		chatId = 12345,
		messageText = "",
		entities = [],
		replyToFrom,
		memberCount,
		memberCountError = false,
	} = overrides;

	const sendMessageMock = mock(async () => ({}));
	const replyMock = mock(async () => ({}));
	const getChatMemberCountMock = memberCountError
		? mock(async () => {
				throw new Error("Failed to get member count");
			})
		: mock(async () => memberCount ?? 5);

	return {
		chat: {
			type: chatType,
			id: chatId,
		},
		message: {
			text: messageText,
			entities,
			reply_to_message: replyToFrom
				? { from: { username: replyToFrom.username } }
				: undefined,
		},
		api: {
			sendMessage: sendMessageMock,
			getChatMemberCount: getChatMemberCountMock,
		},
		reply: replyMock,
		getFile: mock(async () => ({ file_path: "test/file" })),
	};
}

// ============== Tests ==============

describe("isBotMentioned", () => {
	const botUsername = "test_bot";

	test("returns true for private chats", async () => {
		const ctx = createMockContext({ chatType: "private" });
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(true);
	});

	test("returns false when chat is null", async () => {
		const ctx = { chat: null, message: null, api: {} };
		const result = await isBotMentioned(ctx as any, botUsername);
		expect(result).toBe(false);
	});

	test("returns true in group with only 2 members", async () => {
		const ctx = createMockContext({
			chatType: "group",
			memberCount: 2,
			messageText: "hello",
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(true);
	});

	test("returns true in supergroup with only 2 members", async () => {
		const ctx = createMockContext({
			chatType: "supergroup",
			memberCount: 2,
			messageText: "hello",
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(true);
	});

	test("returns false in group with many members and no mention", async () => {
		const ctx = createMockContext({
			chatType: "group",
			memberCount: 10,
			messageText: "hello everyone",
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(false);
	});

	test("returns true when bot is mentioned with @", async () => {
		const ctx = createMockContext({
			chatType: "group",
			memberCount: 10,
			messageText: "@test_bot help me",
			entities: [{ type: "mention", offset: 0, length: 9 }],
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(true);
	});

	test("returns false when different bot is mentioned", async () => {
		const ctx = createMockContext({
			chatType: "group",
			memberCount: 10,
			messageText: "@other_bot help me",
			entities: [{ type: "mention", offset: 0, length: 10 }],
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(false);
	});

	test("returns true for text_mention entity", async () => {
		const ctx = createMockContext({
			chatType: "group",
			memberCount: 10,
			messageText: "@test_bot do something",
			entities: [{ type: "text_mention", offset: 0, length: 9 }],
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(true);
	});

	test("returns true for bot_command with @username", async () => {
		const ctx = createMockContext({
			chatType: "group",
			memberCount: 10,
			messageText: "/start@test_bot",
			entities: [{ type: "bot_command", offset: 0, length: 15 }],
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(true);
	});

	test("returns true when replying to bot's message", async () => {
		const ctx = createMockContext({
			chatType: "group",
			memberCount: 10,
			messageText: "thanks for the help",
			replyToFrom: { username: botUsername },
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(true);
	});

	test("returns false when replying to different user's message", async () => {
		const ctx = createMockContext({
			chatType: "group",
			memberCount: 10,
			messageText: "I agree",
			replyToFrom: { username: "other_user" },
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(false);
	});

	test("returns false when no message in context", async () => {
		const ctx = {
			chat: { type: "group" as const, id: 123 },
			message: null,
			api: {
				getChatMemberCount: mock(async () => 10),
			},
		};
		const result = await isBotMentioned(ctx as any, botUsername);
		expect(result).toBe(false);
	});

	test("falls through to mention check on member count error", async () => {
		// When getChatMemberCount fails, it should fall through to mention check
		const ctx = createMockContext({
			chatType: "group",
			memberCountError: true,
			messageText: "hello",
		});
		const result = await isBotMentioned(ctx, botUsername);
		expect(result).toBe(false); // No mention in message
	});
});

describe("sendPrivateMessage", () => {
	test("returns true on successful send", async () => {
		const ctx = createMockContext();
		const result = await sendPrivateMessage(ctx, 123, "Hello");
		expect(result).toBe(true);
		expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
	});

	test("passes options to sendMessage", async () => {
		const ctx = createMockContext();
		await sendPrivateMessage(ctx, 123, "<b>Bold</b>", {
			parse_mode: "HTML",
		});
		expect(ctx.api.sendMessage).toHaveBeenCalledWith(123, "<b>Bold</b>", {
			parse_mode: "HTML",
		});
	});

	test("returns false when send fails", async () => {
		const ctx = createMockContext();
		ctx.api.sendMessage = mock(async () => {
			throw new Error("User has not started the bot");
		});

		const result = await sendPrivateMessage(ctx, 123, "Hello");
		expect(result).toBe(false);
	});
});

describe("handleUnauthorized", () => {
	test("sends private message in group chat", async () => {
		const ctx = createMockContext({ chatType: "group" });
		const result = await handleUnauthorized(ctx, 123);

		expect(result).toBe(true);
		expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
		// Should not reply in group
		expect(ctx.reply).not.toHaveBeenCalled();
	});

	test("sends private message in supergroup chat", async () => {
		const ctx = createMockContext({ chatType: "supergroup" });
		const result = await handleUnauthorized(ctx, 456);

		expect(result).toBe(true);
		expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
	});

	test("replies directly in private chat", async () => {
		const ctx = createMockContext({ chatType: "private" });
		const result = await handleUnauthorized(ctx, 789);

		expect(result).toBe(true);
		expect(ctx.reply).toHaveBeenCalledTimes(1);
		expect(ctx.reply).toHaveBeenCalledWith(
			"Unauthorized. Contact the bot owner for access.",
		);
	});

	test("always returns true", async () => {
		const ctx1 = createMockContext({ chatType: "private" });
		const ctx2 = createMockContext({ chatType: "group" });

		expect(await handleUnauthorized(ctx1, 1)).toBe(true);
		expect(await handleUnauthorized(ctx2, 2)).toBe(true);
	});
});

describe("effectFor", () => {
	test("returns effect ID for private chats", () => {
		const ctx = createMockContext({ chatType: "private" });
		const result = effectFor(ctx, "effect123");
		expect(result).toBe("effect123");
	});

	test("returns undefined for group chats", () => {
		const ctx = createMockContext({ chatType: "group" });
		const result = effectFor(ctx, "effect123");
		expect(result).toBeUndefined();
	});

	test("returns undefined for supergroup chats", () => {
		const ctx = createMockContext({ chatType: "supergroup" });
		const result = effectFor(ctx, "effect123");
		expect(result).toBeUndefined();
	});

	test("returns undefined for channel chats", () => {
		const ctx = createMockContext({ chatType: "channel" });
		const result = effectFor(ctx, "effect123");
		expect(result).toBeUndefined();
	});
});

describe("checkInterrupt", () => {
	test("returns text unchanged if no ! prefix", async () => {
		const result = await checkInterrupt("hello world");
		expect(result).toBe("hello world");
	});

	test("returns empty string unchanged", async () => {
		const result = await checkInterrupt("");
		expect(result).toBe("");
	});

	test("strips ! prefix and trims", async () => {
		const result = await checkInterrupt("!do something else");
		expect(result).toBe("do something else");
	});

	test("handles ! with extra whitespace", async () => {
		const result = await checkInterrupt("!   spaced out");
		expect(result).toBe("spaced out");
	});

	test("returns text without prefix for non-! messages", async () => {
		const result = await checkInterrupt("regular message");
		expect(result).toBe("regular message");
	});

	test("handles null/undefined gracefully", async () => {
		const result = await checkInterrupt(null as unknown as string);
		expect(result).toBeFalsy();
	});
});
