/**
 * Command handler exports.
 *
 * Re-exports all public command handlers for backward compatibility.
 */

export {
	handleModel,
	handleProvider,
	handleThink,
	handlePlan,
	handleCompact,
	handleCost,
} from "./config";

export {
	handleCd,
	handleFile,
	handleImage,
	handlePdf,
	handleDocx,
	handleHtml,
	handleBookmarks,
} from "./files";

export {
	handleWorktree,
	handleBranch,
	handleMerge,
	handleSkill,
	handleDiff,
} from "./git";

export { createCustomCommandHandler } from "./custom";

export { executeRestart, handleRestart } from "./restart";

export {
	handleStart,
	handleNew,
	handleStop,
	handleStatus,
	handlePending,
	handleResume,
	handleRetry,
	handleHandoff,
	handleUndo,
} from "./session";
