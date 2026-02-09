/**
 * Voice transcription utilities for Claude Telegram Bot.
 *
 * Uses OpenAI's transcription API to convert voice messages to text.
 */

import OpenAI from "openai";
import {
	OPENAI_API_KEY,
	TRANSCRIPTION_AVAILABLE,
	TRANSCRIPTION_PROMPT,
} from "../config";

// ============== OpenAI Client ==============

let openaiClient: OpenAI | null = null;
if (OPENAI_API_KEY && TRANSCRIPTION_AVAILABLE) {
	openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
}

// ============== Voice Transcription ==============

export async function transcribeVoice(
	filePath: string,
): Promise<string | null> {
	if (!openaiClient) {
		console.warn("OpenAI client not available for transcription");
		return null;
	}

	try {
		const file = Bun.file(filePath);
		const transcript = await openaiClient.audio.transcriptions.create({
			model: "gpt-4o-transcribe",
			file: file,
			prompt: TRANSCRIPTION_PROMPT,
		});
		return transcript.text;
	} catch (error) {
		console.error("Transcription failed:", error);
		return null;
	}
}
