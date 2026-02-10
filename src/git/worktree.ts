/**
 * Git worktree operations.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPathAllowed } from "../security";
import {
	branchExists,
	execGit,
	getRepoRoot,
	sanitizeWorktreeName,
} from "./exec";
import type { BranchListResult, WorktreeResult } from "./types";

export async function getWorktreeMap(
	repoRoot: string,
): Promise<Map<string, string>> {
	const result = await execGit(["worktree", "list", "--porcelain"], repoRoot);
	if (result.exitCode !== 0) {
		return new Map();
	}

	const map = new Map<string, string>();
	const lines = result.stdout.split("\n");
	let currentPath: string | null = null;
	let currentBranch: string | null = null;

	for (const line of lines) {
		if (line.startsWith("worktree ")) {
			currentPath = line.slice("worktree ".length).trim();
			currentBranch = null;
			continue;
		}
		if (line.startsWith("branch ")) {
			const ref = line.slice("branch ".length).trim();
			const prefix = "refs/heads/";
			currentBranch = ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
			continue;
		}
		if (line.trim() === "") {
			if (currentPath && currentBranch) {
				map.set(currentBranch, currentPath);
			}
			currentPath = null;
			currentBranch = null;
		}
	}

	if (currentPath && currentBranch) {
		map.set(currentBranch, currentPath);
	}

	return map;
}

export async function listBranches(cwd: string): Promise<BranchListResult> {
	const repoRoot = await getRepoRoot(cwd);
	if (!repoRoot) {
		return { success: false, message: "Not inside a git repository." };
	}

	const currentResult = await execGit(["branch", "--show-current"], repoRoot);
	const current =
		currentResult.exitCode === 0 ? currentResult.stdout.trim() || null : null;

	const listResult = await execGit(
		["branch", "--format=%(refname:short)"],
		repoRoot,
	);
	if (listResult.exitCode !== 0) {
		return {
			success: false,
			message: listResult.stderr.trim() || "Failed to list branches.",
		};
	}

	const branches = listResult.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	return { success: true, branches, current, repoRoot };
}

export async function getWorkingTreeStatus(cwd: string): Promise<{
	success: boolean;
	dirty: boolean;
	message?: string;
}> {
	const repoRoot = await getRepoRoot(cwd);
	if (!repoRoot) {
		return {
			success: false,
			dirty: false,
			message: "Not inside a git repository.",
		};
	}

	const statusResult = await execGit(["status", "--porcelain"], repoRoot);
	if (statusResult.exitCode !== 0) {
		return {
			success: false,
			dirty: false,
			message: statusResult.stderr.trim() || "Failed to check git status.",
		};
	}

	return { success: true, dirty: statusResult.stdout.trim().length > 0 };
}

export async function createOrReuseWorktree(
	cwd: string,
	branch: string,
): Promise<WorktreeResult> {
	const trimmed = branch.trim();
	if (!trimmed) {
		return { success: false, message: "Branch name cannot be empty." };
	}

	const repoRoot = await getRepoRoot(cwd);
	if (!repoRoot) {
		return { success: false, message: "Not inside a git repository." };
	}

	const worktreeMap = await getWorktreeMap(repoRoot);
	const existing = worktreeMap.get(trimmed);
	if (existing) {
		if (!isPathAllowed(existing)) {
			return {
				success: false,
				message: `Existing worktree path is not in allowed directories: ${existing}`,
			};
		}
		return {
			success: true,
			branch: trimmed,
			path: existing,
			reused: true,
			message: `Using existing worktree for ${trimmed}.`,
		};
	}

	const folderName = sanitizeWorktreeName(trimmed);
	if (!folderName) {
		return {
			success: false,
			message: "Branch name results in an invalid worktree path.",
		};
	}

	const baseDir = join(repoRoot, ".worktrees");
	if (!isPathAllowed(baseDir)) {
		return {
			success: false,
			message:
				`Worktree base directory is not in allowed paths: ${baseDir}. ` +
				"Update ALLOWED_PATHS to include this directory.",
		};
	}
	try {
		mkdirSync(baseDir, { recursive: true });
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			message: `Failed to create worktree base directory: ${errMsg}`,
		};
	}

	const targetPath = join(baseDir, folderName);
	if (!isPathAllowed(targetPath)) {
		return {
			success: false,
			message:
				`Worktree path is not in allowed directories: ${targetPath}. ` +
				"Update ALLOWED_PATHS to include this directory.",
		};
	}
	const exists = await branchExists(repoRoot, trimmed);
	const args = exists
		? ["worktree", "add", targetPath, trimmed]
		: ["worktree", "add", "-b", trimmed, targetPath];

	const addResult = await execGit(args, repoRoot);
	if (addResult.exitCode !== 0) {
		return {
			success: false,
			message: addResult.stderr.trim() || "Failed to create git worktree.",
		};
	}

	return {
		success: true,
		branch: trimmed,
		path: targetPath,
		reused: false,
		message: `Created worktree for ${trimmed}.`,
	};
}
