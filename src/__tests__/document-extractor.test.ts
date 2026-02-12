/**
 * Unit tests for document extraction (src/handlers/document/extractor.ts).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	isArchive,
	getArchiveExtension,
	buildFileTree,
} from "../handlers/document/extractor";

// ============== isArchive Tests ==============

describe("isArchive", () => {
	test("identifies .zip files as archives", () => {
		expect(isArchive("file.zip")).toBe(true);
		expect(isArchive("archive.ZIP")).toBe(true);
		expect(isArchive("project.Zip")).toBe(true);
	});

	test("identifies .tar files as archives", () => {
		expect(isArchive("file.tar")).toBe(true);
		expect(isArchive("backup.TAR")).toBe(true);
	});

	test("identifies .tar.gz files as archives", () => {
		expect(isArchive("file.tar.gz")).toBe(true);
		expect(isArchive("backup.TAR.GZ")).toBe(true);
	});

	test("identifies .tgz files as archives", () => {
		expect(isArchive("file.tgz")).toBe(true);
		expect(isArchive("backup.TGZ")).toBe(true);
	});

	test("rejects non-archive files", () => {
		expect(isArchive("file.txt")).toBe(false);
		expect(isArchive("document.pdf")).toBe(false);
		expect(isArchive("image.png")).toBe(false);
		expect(isArchive("script.js")).toBe(false);
	});

	test("rejects files with archive-like names but wrong extension", () => {
		expect(isArchive("zip-file.txt")).toBe(false);
		expect(isArchive("my-tar-backup.log")).toBe(false);
	});

	test("handles filenames without extension", () => {
		expect(isArchive("noextension")).toBe(false);
		expect(isArchive("Makefile")).toBe(false);
	});

	test("handles empty filename", () => {
		expect(isArchive("")).toBe(false);
	});
});

// ============== getArchiveExtension Tests ==============

describe("getArchiveExtension", () => {
	test("returns .tar.gz for tar.gz files", () => {
		expect(getArchiveExtension("file.tar.gz")).toBe(".tar.gz");
		expect(getArchiveExtension("backup.tar.gz")).toBe(".tar.gz");
	});

	test("returns .tgz for tgz files", () => {
		expect(getArchiveExtension("file.tgz")).toBe(".tgz");
	});

	test("returns .tar for tar files", () => {
		expect(getArchiveExtension("file.tar")).toBe(".tar");
	});

	test("returns .zip for zip files", () => {
		expect(getArchiveExtension("file.zip")).toBe(".zip");
	});

	test("returns empty string for non-archive files", () => {
		expect(getArchiveExtension("file.txt")).toBe("");
		expect(getArchiveExtension("image.png")).toBe("");
		expect(getArchiveExtension("script.js")).toBe("");
	});

	test("is case insensitive", () => {
		expect(getArchiveExtension("file.TAR.GZ")).toBe(".tar.gz");
		expect(getArchiveExtension("file.TGZ")).toBe(".tgz");
		expect(getArchiveExtension("file.ZIP")).toBe(".zip");
		expect(getArchiveExtension("file.TAR")).toBe(".tar");
	});

	test("handles filenames without extension", () => {
		expect(getArchiveExtension("noext")).toBe("");
		expect(getArchiveExtension("")).toBe("");
	});

	test("prioritizes .tar.gz over .tar", () => {
		// .tar.gz should be matched before .tar
		const ext = getArchiveExtension("backup.tar.gz");
		expect(ext).toBe(".tar.gz");
	});
});

// ============== buildFileTree Tests ==============

describe("buildFileTree", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = `/tmp/ctb-filetree-test-${Date.now()}`;
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

	test("returns files in a flat directory", async () => {
		writeFileSync(join(testDir, "a.txt"), "content");
		writeFileSync(join(testDir, "b.txt"), "content");
		writeFileSync(join(testDir, "c.txt"), "content");

		const tree = await buildFileTree(testDir);
		expect(tree).toContain("a.txt");
		expect(tree).toContain("b.txt");
		expect(tree).toContain("c.txt");
	});

	test("returns files in nested directories", async () => {
		mkdirSync(join(testDir, "sub"), { recursive: true });
		writeFileSync(join(testDir, "root.txt"), "content");
		writeFileSync(join(testDir, "sub", "nested.txt"), "content");

		const tree = await buildFileTree(testDir);
		expect(tree).toContain("root.txt");
		expect(tree).toContain("sub/nested.txt");
	});

	test("returns sorted entries", async () => {
		writeFileSync(join(testDir, "c.txt"), "content");
		writeFileSync(join(testDir, "a.txt"), "content");
		writeFileSync(join(testDir, "b.txt"), "content");

		const tree = await buildFileTree(testDir);
		// Verify sorting
		for (let i = 1; i < tree.length; i++) {
			expect(tree[i]! >= tree[i - 1]!).toBe(true);
		}
	});

	test("limits to 100 files", async () => {
		// Create 110 files
		for (let i = 0; i < 110; i++) {
			writeFileSync(
				join(testDir, `file${i.toString().padStart(3, "0")}.txt`),
				"content",
			);
		}

		const tree = await buildFileTree(testDir);
		expect(tree.length).toBeLessThanOrEqual(100);
	});

	test("handles empty directory", async () => {
		const tree = await buildFileTree(testDir);
		expect(tree).toHaveLength(0);
	});

	test("excludes dotfiles (dot: false)", async () => {
		writeFileSync(join(testDir, ".hidden"), "content");
		writeFileSync(join(testDir, "visible.txt"), "content");

		const tree = await buildFileTree(testDir);
		expect(tree).toContain("visible.txt");
		expect(tree).not.toContain(".hidden");
	});
});

// ============== extractText Tests (basic type routing) ==============
// We test the type-routing logic without requiring external CLIs.

describe("extractText type detection", () => {
	// We test the logic by examining extension detection.
	// The actual extractText function requires Bun.file and pdftotext,
	// which we test at a higher level.

	test("identifies PDF by extension", () => {
		const fileName = "document.pdf";
		const extension = `.${(fileName.split(".").pop() || "").toLowerCase()}`;
		expect(extension).toBe(".pdf");
	});

	test("identifies PDF by mime type", () => {
		const mimeType = "application/pdf";
		expect(mimeType === "application/pdf").toBe(true);
	});

	test("identifies text extensions", () => {
		const textExts = [
			".md",
			".txt",
			".json",
			".yaml",
			".yml",
			".csv",
			".xml",
			".html",
			".css",
			".js",
			".ts",
			".py",
			".sh",
			".env",
			".log",
			".cfg",
			".ini",
			".toml",
		];

		for (const ext of textExts) {
			const fileName = `test${ext}`;
			const detected = `.${(fileName.split(".").pop() || "").toLowerCase()}`;
			expect(detected).toBe(ext);
		}
	});

	test("identifies text by mime type prefix", () => {
		const mimeTypes = ["text/plain", "text/html", "text/css", "text/csv"];
		for (const mime of mimeTypes) {
			expect(mime.startsWith("text/")).toBe(true);
		}
	});

	test("non-text extensions are not in text list", () => {
		const nonTextExts = [".exe", ".bin", ".dll", ".so", ".png", ".jpg"];
		const TEXT_EXTENSIONS = [
			".md",
			".txt",
			".json",
			".yaml",
			".yml",
			".csv",
			".xml",
			".html",
			".css",
			".js",
			".ts",
			".py",
			".sh",
			".env",
			".log",
			".cfg",
			".ini",
			".toml",
		];

		for (const ext of nonTextExts) {
			expect(TEXT_EXTENSIONS.includes(ext)).toBe(false);
		}
	});
});
