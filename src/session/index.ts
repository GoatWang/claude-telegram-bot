/**
 * Session management barrel file.
 * Re-exports everything for backward compatibility.
 */

export { SESSION_VERSION } from "./types";
export { getThinkingLevel, _getTextFromMessage, createProvider, resolveProvider } from "./thinking";
export { ClaudeSession } from "./claude-session";
export { SessionManager } from "./session-manager";

// Singleton instances
import { SessionManager } from "./session-manager";
import { ClaudeSession } from "./claude-session";

// Export singleton SessionManager
export const sessionManager = new SessionManager();

// Global session instance (DEPRECATED - will be removed)
// Use sessionManager.getSession(chatId) instead
export const session = new ClaudeSession();
