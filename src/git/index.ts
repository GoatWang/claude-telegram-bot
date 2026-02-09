/**
 * Git operations - public API.
 */

// Types
export type {
	WorktreeResult,
	BranchListResult,
	MergeInfo,
	DiffFileSummary,
	DiffResult,
} from "./types";

// Exec helpers (only public ones)
export { sanitizeWorktreeName } from "./exec";

// Worktree operations
export {
	createOrReuseWorktree,
	listBranches,
	getWorkingTreeStatus,
} from "./worktree";

// Diff operations
export { getGitDiff, getCombinedDiff, revertAllChanges } from "./diff";

// Merge operations
export { getMergeInfo } from "./merge";
