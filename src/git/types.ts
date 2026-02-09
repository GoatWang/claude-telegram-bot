/**
 * Shared types for git operations.
 */

export type WorktreeResult =
	| {
			success: true;
			branch: string;
			path: string;
			reused: boolean;
			message: string;
	  }
	| {
			success: false;
			message: string;
	  };

export type BranchListResult =
	| {
			success: true;
			branches: string[];
			current: string | null;
			repoRoot: string;
	  }
	| {
			success: false;
			message: string;
	  };

export type MergeInfo =
	| {
			success: true;
			currentBranch: string;
			mainBranch: string;
			mainWorktreePath: string;
			repoRoot: string;
	  }
	| {
			success: false;
			message: string;
	  };

export type DiffFileSummary = {
	file: string;
	added: number;
	removed: number;
};

export type DiffResult =
	| {
			success: true;
			summary: DiffFileSummary[];
			fullDiff: string;
			hasChanges: boolean;
	  }
	| {
			success: false;
			message: string;
	  };
