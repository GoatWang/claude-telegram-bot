/**
 * Unit tests for git exec helpers (src/git/exec.ts).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, existsSync } from "node:fs";
import {
	sanitizeWorktreeName,
	execGit,
	getRepoRoot,
	branchExists,
	getMainBranch,
} from "../git/exec";

// ============== sanitizeWorktreeName Tests ==============
// These complement the tests in worktree.test.ts by testing the function
// directly from the exec module.

describe("sanitizeWorktreeName (from exec)", () => {
	test("keeps simple names unchanged", () => {
		expect(sanitizeWorktreeName("main")).toBe("main");
		expect(sanitizeWorktreeName("develop")).toBe("develop");
		expect(sanitizeWorktreeName("v1.0.0")).toBe("v1.0.0");
	});

	test("trims whitespace", () => {
		expect(sanitizeWorktreeName("  main  ")).toBe("main");
		expect(sanitizeWorktreeName("\tmain\n")).toBe("main");
	});

	test("converts slashes to hyphens", () => {
		expect(sanitizeWorktreeName("feature/auth")).toBe("feature-auth");
		expect(sanitizeWorktreeName("feature\\auth")).toBe("feature-auth");
		expect(sanitizeWorktreeName("a/b/c")).toBe("a-b-c");
	});

	test("converts consecutive slashes to single hyphen", () => {
		expect(sanitizeWorktreeName("feature//auth")).toBe("feature-auth");
	});

	test("removes special characters", () => {
		expect(sanitizeWorktreeName("feature@auth")).toBe("feature-auth");
		expect(sanitizeWorktreeName("feature#123")).toBe("feature-123");
		expect(sanitizeWorktreeName("feature$test")).toBe("feature-test");
	});

	test("removes leading and trailing hyphens", () => {
		expect(sanitizeWorktreeName("-feature")).toBe("feature");
		expect(sanitizeWorktreeName("feature-")).toBe("feature");
		expect(sanitizeWorktreeName("---feature---")).toBe("feature");
	});

	test("returns empty string for empty input", () => {
		expect(sanitizeWorktreeName("")).toBe("");
		expect(sanitizeWorktreeName("   ")).toBe("");
	});

	test("returns empty for only special characters", () => {
		expect(sanitizeWorktreeName("@#$%^&*")).toBe("");
	});

	test("preserves dots and underscores", () => {
		expect(sanitizeWorktreeName("v1.2.3")).toBe("v1.2.3");
		expect(sanitizeWorktreeName("feature_test")).toBe("feature_test");
	});
});

// ============== execGit Tests ==============

describe("execGit", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = `/tmp/git-exec-test-${Date.now()}`;
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		try {
			const { rmSync } = require("node:fs");
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	test("executes git version successfully", async () => {
		const result = await execGit(["version"], testDir);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("git version");
		expect(result.stderr).toBe("");
	});

	test("returns non-zero exit code for invalid command", async () => {
		const result = await execGit(["nonexistent-subcommand"], testDir);
		expect(result.exitCode).not.toBe(0);
	});

	test("returns stderr on error", async () => {
		const result = await execGit(["log"], testDir);
		// Running git log in a non-repo directory should fail
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.length).toBeGreaterThan(0);
	});

	test("captures stdout from git commands", async () => {
		// Init a temporary git repo
		await execGit(["init"], testDir);
		const result = await execGit(["status"], testDir);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBeGreaterThan(0);
	});

	test("respects working directory", async () => {
		await execGit(["init"], testDir);
		const result = await execGit(["rev-parse", "--show-toplevel"], testDir);
		expect(result.exitCode).toBe(0);
		// macOS resolves /tmp -> /private/tmp
		expect(result.stdout.trim()).toMatch(/\/?tmp\/git-exec-test-/);
	});
});

// ============== getRepoRoot Tests ==============

describe("getRepoRoot", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = `/tmp/git-repo-root-test-${Date.now()}`;
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		try {
			const { rmSync } = require("node:fs");
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	test("returns repo root for a git repo", async () => {
		await execGit(["init"], testDir);
		const root = await getRepoRoot(testDir);
		expect(root).not.toBeNull();
		// macOS resolves /tmp -> /private/tmp
		expect(root).toMatch(/\/?tmp\/git-repo-root-test-/);
	});

	test("returns null for non-repo directory", async () => {
		const root = await getRepoRoot(testDir);
		expect(root).toBeNull();
	});

	test("returns repo root from a subdirectory", async () => {
		await execGit(["init"], testDir);
		const subDir = `${testDir}/sub/dir`;
		mkdirSync(subDir, { recursive: true });
		const root = await getRepoRoot(subDir);
		expect(root).not.toBeNull();
		expect(root).toMatch(/\/?tmp\/git-repo-root-test-/);
	});
});

// ============== branchExists Tests ==============

describe("branchExists", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = `/tmp/git-branch-test-${Date.now()}`;
		mkdirSync(testDir, { recursive: true });
		// Create a git repo with an initial commit
		await execGit(["init"], testDir);
		await execGit(["config", "user.email", "test@test.com"], testDir);
		await execGit(["config", "user.name", "Test"], testDir);
		// Need at least one commit for branches to exist
		await execGit(["commit", "--allow-empty", "-m", "Initial commit"], testDir);
	});

	afterEach(() => {
		try {
			const { rmSync } = require("node:fs");
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	test("returns true for existing branch", async () => {
		// Default branch is typically main or master
		const result = await execGit(["branch", "--show-current"], testDir);
		const currentBranch = result.stdout.trim();
		expect(await branchExists(testDir, currentBranch)).toBe(true);
	});

	test("returns false for non-existing branch", async () => {
		expect(await branchExists(testDir, "nonexistent-branch-xyz")).toBe(false);
	});

	test("returns true for newly created branch", async () => {
		await execGit(["branch", "test-branch"], testDir);
		expect(await branchExists(testDir, "test-branch")).toBe(true);
	});
});

// ============== getMainBranch Tests ==============

describe("getMainBranch", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = `/tmp/git-main-test-${Date.now()}`;
		mkdirSync(testDir, { recursive: true });
		await execGit(["init", "-b", "main"], testDir);
		await execGit(["config", "user.email", "test@test.com"], testDir);
		await execGit(["config", "user.name", "Test"], testDir);
		await execGit(["commit", "--allow-empty", "-m", "Initial commit"], testDir);
	});

	afterEach(() => {
		try {
			const { rmSync } = require("node:fs");
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	test("returns 'main' when main branch exists", async () => {
		const result = await getMainBranch(testDir);
		expect(result).toBe("main");
	});

	test("returns 'master' when only master exists", async () => {
		// Rename main to master
		await execGit(["branch", "-m", "main", "master"], testDir);
		const result = await getMainBranch(testDir);
		expect(result).toBe("master");
	});

	test("prefers 'main' over 'master' when both exist", async () => {
		// Create master branch in addition to main
		await execGit(["branch", "master"], testDir);
		const result = await getMainBranch(testDir);
		expect(result).toBe("main");
	});

	test("returns null when neither main nor master exists", async () => {
		// Rename main to something else
		await execGit(["branch", "-m", "main", "develop"], testDir);
		const result = await getMainBranch(testDir);
		expect(result).toBeNull();
	});
});
