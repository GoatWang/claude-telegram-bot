/**
 * Git merge operations.
 */

import { execGit, getMainBranch, getRepoRoot } from "./exec";
import type { MergeInfo } from "./types";
import { getWorktreeMap } from "./worktree";

/**
 * Get merge info: current branch, main branch, and main worktree path.
 * Used by /merge command.
 */
export async function getMergeInfo(cwd: string): Promise<MergeInfo> {
	const repoRoot = await getRepoRoot(cwd);
	if (!repoRoot) {
		return { success: false, message: "Not inside a git repository." };
	}

	// Get current branch
	const currentResult = await execGit(["branch", "--show-current"], repoRoot);
	const currentBranch =
		currentResult.exitCode === 0 ? currentResult.stdout.trim() : null;

	if (!currentBranch) {
		return { success: false, message: "Not on a branch (detached HEAD)." };
	}

	// Find main/master
	const mainBranch = await getMainBranch(repoRoot);
	if (!mainBranch) {
		return { success: false, message: "No main or master branch found." };
	}

	if (currentBranch === mainBranch) {
		return { success: false, message: `Already on ${mainBranch} branch.` };
	}

	// Find or determine main worktree path
	const worktreeMap = await getWorktreeMap(repoRoot);
	const mainWorktreePath = worktreeMap.get(mainBranch);
	if (!mainWorktreePath) {
		return {
			success: false,
			message: `Main branch (${mainBranch}) is not checked out in any worktree.`,
		};
	}

	return {
		success: true,
		currentBranch,
		mainBranch,
		mainWorktreePath,
		repoRoot,
	};
}
