import { describe, expect, test } from "bun:test";
import { setBotUsername } from "../config";
import { buildPhotoPrompt } from "../handlers/photo";

describe("buildPhotoPrompt", () => {
	setBotUsername("clickup_oysterun_bot");

	test("keeps image context before a normal caption", () => {
		expect(
			buildPhotoPrompt(
				["/tmp/photo.jpg"],
				"Summarize the issue in this screenshot",
			),
		).toBe(
			"[Photo saved to: /tmp/photo.jpg]\n\nSummarize the issue in this screenshot",
		);
	});

	test("keeps slash commands at the start of the prompt", () => {
		expect(
			buildPhotoPrompt(
				["/tmp/photo.jpg"],
				'/add_task remove "/100" limitation',
			),
		).toBe(
			'/add_task remove "/100" limitation\n\n[Photo saved to: /tmp/photo.jpg]',
		);
	});

	test("strips the bot mention from slash-command captions", () => {
		expect(
			buildPhotoPrompt(
				["/tmp/photo.jpg"],
				'/add_task @clickup_oysterun_bot remove "/100" limitation',
			),
		).toBe(
			'/add_task remove "/100" limitation\n\n[Photo saved to: /tmp/photo.jpg]',
		);
	});
});
