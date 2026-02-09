/**
 * Git diff operations.
 */

import { execGit, getRepoRoot } from "./exec";
import type { DiffFileSummary, DiffResult } from "./types";

/**
 * Get git diff with summary statistics.
 * @param cwd Working directory
 * @param options.staged Show only staged changes
 * @param options.file Show diff for specific file
 */
export async function getGitDiff(
	cwd: string,
	options?: { staged?: boolean; file?: string },
): Promise<DiffResult> {
	const repoRoot = await getRepoRoot(cwd);
	if (!repoRoot) {
		return { success: false, message: "Not inside a git repository." };
	}

	// Build diff args
	const diffArgs = ["diff"];
	if (options?.staged) {
		diffArgs.push("--staged");
	}
	diffArgs.push("--stat", "--numstat");
	if (options?.file) {
		diffArgs.push("--", options.file);
	}

	const statResult = await execGit(diffArgs, repoRoot);
	if (statResult.exitCode !== 0) {
		return {
			success: false,
			message: statResult.stderr.trim() || "Failed to get diff stats.",
		};
	}

	// Parse numstat output (added\tremoved\tfilename)
	const summary: DiffFileSummary[] = [];
	const lines = statResult.stdout.split("\n");
	for (const line of lines) {
		const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
		if (match) {
			const addedStr = match[1] ?? "0";
			const removedStr = match[2] ?? "0";
			const added = addedStr === "-" ? 0 : Number.parseInt(addedStr, 10);
			const removed = removedStr === "-" ? 0 : Number.parseInt(removedStr, 10);
			const file = match[3];
			if (file) {
				summary.push({ file, added, removed });
			}
		}
	}

	// Get full diff
	const fullDiffArgs = ["diff"];
	if (options?.staged) {
		fullDiffArgs.push("--staged");
	}
	if (options?.file) {
		fullDiffArgs.push("--", options.file);
	}

	const fullDiffResult = await execGit(fullDiffArgs, repoRoot);
	const fullDiff = fullDiffResult.stdout;

	return {
		success: true,
		summary,
		fullDiff,
		hasChanges: summary.length > 0 || fullDiff.trim().length > 0,
	};
}

/**
 * Get combined diff (staged + unstaged).
 */
export async function getCombinedDiff(
	cwd: string,
	options?: { file?: string },
): Promise<DiffResult> {
	const repoRoot = await getRepoRoot(cwd);
	if (!repoRoot) {
		return { success: false, message: "Not inside a git repository." };
	}

	// Get unstaged diff
	const unstagedResult = await getGitDiff(cwd, { file: options?.file });
	if (!unstagedResult.success) {
		return unstagedResult;
	}

	// Get staged diff
	const stagedResult = await getGitDiff(cwd, {
		staged: true,
		file: options?.file,
	});
	if (!stagedResult.success) {
		return stagedResult;
	}

	// Merge summaries (combine files that appear in both)
	const fileMap = new Map<string, DiffFileSummary>();
	for (const item of unstagedResult.summary) {
		fileMap.set(item.file, { ...item });
	}
	for (const item of stagedResult.summary) {
		const existing = fileMap.get(item.file);
		if (existing) {
			existing.added += item.added;
			existing.removed += item.removed;
		} else {
			fileMap.set(item.file, { ...item });
		}
	}

	const summary = Array.from(fileMap.values());

	// Combine full diffs
	let fullDiff = "";
	if (stagedResult.fullDiff.trim()) {
		fullDiff += `=== Staged Changes ===\n${stagedResult.fullDiff}`;
	}
	if (unstagedResult.fullDiff.trim()) {
		if (fullDiff) fullDiff += "\n";
		fullDiff += `=== Unstaged Changes ===\n${unstagedResult.fullDiff}`;
	}

	return {
		success: true,
		summary,
		fullDiff,
		hasChanges: summary.length > 0 || fullDiff.trim().length > 0,
	};
}

/**
 * Revert all uncommitted changes (both staged and unstaged).
 * This is destructive - use with confirmation!
 */
export async function revertAllChanges(cwd: string): Promise<{
	success: boolean;
	message: string;
}> {
	const repoRoot = await getRepoRoot(cwd);
	if (!repoRoot) {
		return { success: false, message: "Not inside a git repository." };
	}

	// Reset staged changes
	const resetResult = await execGit(["reset", "HEAD"], repoRoot);
	if (resetResult.exitCode !== 0 && !resetResult.stderr.includes("HEAD")) {
		return {
			success: false,
			message: resetResult.stderr.trim() || "Failed to unstage changes.",
		};
	}

	// Discard unstaged changes
	const checkoutResult = await execGit(["checkout", "--", "."], repoRoot);
	if (checkoutResult.exitCode !== 0) {
		return {
			success: false,
			message: checkoutResult.stderr.trim() || "Failed to discard changes.",
		};
	}

	// Clean untracked files (optional - be careful!)
	// Not cleaning untracked files by default to avoid data loss

	return { success: true, message: "All changes reverted." };
}
