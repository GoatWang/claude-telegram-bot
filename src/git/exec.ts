/**
 * Low-level git command execution helpers.
 */

import { spawn } from "node:child_process";

const GIT_COMMAND_TIMEOUT_MS = Number.parseInt(
	process.env.GIT_COMMAND_TIMEOUT_MS || "20000",
	10,
);

export function sanitizeWorktreeName(branch: string): string {
	return branch
		.trim()
		.replace(/[\\/]+/g, "-")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
}

export async function execGit(
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve) => {
		const proc = spawn("git", args, { cwd });
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let timeout: ReturnType<typeof setTimeout> | null = null;

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			if (timedOut) {
				resolve({
					stdout,
					stderr: stderr || `Git command timed out after ${GIT_COMMAND_TIMEOUT_MS}ms`,
					exitCode: 124,
				});
				return;
			}
			resolve({ stdout, stderr, exitCode: code ?? 0 });
		});

		proc.on("error", (err) => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			resolve({ stdout, stderr: err.message, exitCode: 1 });
		});

		timeout = setTimeout(() => {
			timedOut = true;
			try {
				proc.kill("SIGTERM");
			} catch {
				// Ignore kill errors
			}
		}, GIT_COMMAND_TIMEOUT_MS);
	});
}

export async function getRepoRoot(cwd: string): Promise<string | null> {
	const result = await execGit(["rev-parse", "--show-toplevel"], cwd);
	if (result.exitCode !== 0) {
		return null;
	}
	return result.stdout.trim() || null;
}

export async function branchExists(
	repoRoot: string,
	branch: string,
): Promise<boolean> {
	const result = await execGit(
		["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
		repoRoot,
	);
	return result.exitCode === 0;
}

export async function getMainBranch(repoRoot: string): Promise<string | null> {
	// Check for main first, then master
	for (const branch of ["main", "master"]) {
		const exists = await branchExists(repoRoot, branch);
		if (exists) {
			return branch;
		}
	}
	return null;
}
