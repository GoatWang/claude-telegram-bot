import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentProvider } from "../providers/types";
import { ClaudeSession } from "../session";

describe("FIRST_PROMPT session bootstrap", () => {
	let originalFirstPrompt: string | undefined;

	beforeEach(() => {
		originalFirstPrompt = process.env.FIRST_PROMPT;
	});

	afterEach(() => {
		if (originalFirstPrompt === undefined) {
			delete process.env.FIRST_PROMPT;
		} else {
			process.env.FIRST_PROMPT = originalFirstPrompt;
		}
	});

	test("injects FIRST_PROMPT into a brand-new session", async () => {
		let capturedPrompt = "";
		const provider: AgentProvider<any, any, any> = {
			id: "test",
			createQuery({ prompt }) {
				capturedPrompt = prompt;
				return (async function* () {
					yield { type: "result" };
				})() as any;
			},
		};
		process.env.FIRST_PROMPT = "Always answer in Traditional Chinese.";

		const session = new ClaudeSession(provider);
		await session.sendMessageStreaming("Summarize this repo", "tester", 1, async () => {});

		expect(capturedPrompt).toContain("[First prompt]");
		expect(capturedPrompt).toContain(
			"Always answer in Traditional Chinese.",
		);
		expect(capturedPrompt).toContain("[New request]\nSummarize this repo");
	});

	test("does not inject FIRST_PROMPT into an existing active session", async () => {
		let capturedPrompt = "";
		const provider: AgentProvider<any, any, any> = {
			id: "test",
			createQuery({ prompt }) {
				capturedPrompt = prompt;
				return (async function* () {
					yield { type: "result" };
				})() as any;
			},
		};
		process.env.FIRST_PROMPT = "Always answer in Traditional Chinese.";

		const session = new ClaudeSession(provider);
		session.sessionId = "existing-session";

		await session.sendMessageStreaming("Second message", "tester", 1, async () => {});

		expect(capturedPrompt).toBe("Second message");
	});
});
