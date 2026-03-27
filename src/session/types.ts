/**
 * Types and constants for session management.
 */

import type { SessionData } from "../types";

export const SESSION_VERSION = 1;

function normalizeDir(dir: string): string {
	const normalized = dir.trim().replace(/\/+$/, "");
	return normalized || "/";
}

export function getResumeBlockedReason(
	data: Pick<SessionData, "start_dir" | "working_dir">,
	currentDir: string,
	currentDirLabel = "start folder",
): string | null {
	const normalizedCurrentDir = normalizeDir(currentDir);
	const savedStartDir = data.start_dir ? normalizeDir(data.start_dir) : null;

	if (savedStartDir && savedStartDir !== normalizedCurrentDir) {
		return (
			`Session cannot be resumed because it was started in ${data.start_dir}, ` +
			`but the current ${currentDirLabel} is ${currentDir}. ` +
			`Run without --resume to start fresh in this folder.`
		);
	}

	// Backward compatibility for older session files that only stored working_dir.
	// Permit resumes when the saved working dir is still under the current start
	// folder, but block cross-project restores.
	const savedWorkingDir = data.working_dir ? normalizeDir(data.working_dir) : null;
	if (
		savedWorkingDir &&
		savedWorkingDir !== normalizedCurrentDir &&
		!savedWorkingDir.startsWith(`${normalizedCurrentDir}/`)
	) {
		return (
			`Session cannot be resumed because its saved working folder is ${data.working_dir}, ` +
			`but the current ${currentDirLabel} is ${currentDir}. ` +
			`Run without --resume to start fresh in this folder.`
		);
	}

	return null;
}
