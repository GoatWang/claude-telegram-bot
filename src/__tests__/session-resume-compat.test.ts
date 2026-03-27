import { describe, expect, test } from "bun:test";
import { getResumeBlockedReason } from "../session/types";

describe("resume folder compatibility", () => {
	test("allows resume when saved start folder matches current start folder", () => {
		expect(
			getResumeBlockedReason(
				{
					start_dir: "/Users/test/project",
					working_dir: "/Users/test/project/.worktrees/feature",
				},
				"/Users/test/project",
			),
		).toBeNull();
	});

	test("blocks resume when saved start folder differs from current start folder", () => {
		expect(
			getResumeBlockedReason(
				{
					start_dir: "/Users/test/project-a",
					working_dir: "/Users/test/project-a",
				},
				"/Users/test/project-b",
			),
		).toContain("Session cannot be resumed because it was started in");
	});

	test("allows legacy sessions whose saved working folder is inside the current start folder", () => {
		expect(
			getResumeBlockedReason(
				{
					working_dir: "/Users/test/project/.worktrees/feature",
				},
				"/Users/test/project",
			),
		).toBeNull();
	});

	test("blocks legacy sessions whose saved working folder is outside the current start folder", () => {
		expect(
			getResumeBlockedReason(
				{
					working_dir: "/Users/test/other-project",
				},
				"/Users/test/project",
			),
		).toContain("saved working folder");
	});
});
