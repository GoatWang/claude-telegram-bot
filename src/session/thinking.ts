/**
 * Thinking level detection and provider resolution helpers.
 */

import {
	AGENT_PROVIDER,
	AGENT_PROVIDERS,
	type AgentProviderId,
	THINKING_DEEP_KEYWORDS,
	THINKING_KEYWORDS,
} from "../config";
import {
	ClaudeProvider,
	type ClaudeOptions as Options,
	type ClaudeQuery as Query,
	type ClaudeSDKMessage as SDKMessage,
} from "../providers/claude";
import { CodexProvider } from "../providers/codex";
import type { AgentProvider } from "../providers/types";

/**
 * Determine thinking token budget based on message keywords.
 * Exported for testing.
 */
export function getThinkingLevel(message: string): number {
	const msgLower = message.toLowerCase();

	// Check deep thinking triggers first (more specific)
	if (THINKING_DEEP_KEYWORDS.some((k) => msgLower.includes(k))) {
		return 50000;
	}

	// Check normal thinking triggers
	if (THINKING_KEYWORDS.some((k) => msgLower.includes(k))) {
		return 10000;
	}

	// Default: no thinking
	return 0;
}

/**
 * Extract text content from SDK message.
 * Note: Currently unused but kept for potential future use.
 */
export function _getTextFromMessage(msg: SDKMessage): string | null {
	if (msg.type !== "assistant") return null;

	const textParts: string[] = [];
	for (const block of msg.message.content) {
		if (block.type === "text") {
			textParts.push(block.text);
		}
	}
	return textParts.length > 0 ? textParts.join("") : null;
}

export function createProvider(
	providerId: AgentProviderId,
): AgentProvider<SDKMessage, Options, Query> {
	if (providerId === "codex") {
		return new CodexProvider();
	}
	return new ClaudeProvider();
}

export function resolveProvider(): {
	provider: AgentProvider<SDKMessage, Options, Query>;
	id: AgentProviderId;
} {
	const id = AGENT_PROVIDER;
	return { provider: createProvider(id), id };
}
