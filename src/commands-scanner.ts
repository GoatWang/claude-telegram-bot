/**
 * Scan .claude/commands/ for custom command definitions.
 *
 * Each .md file becomes a Telegram bot command:
 * - Command name derived from file path (subdirectories joined by `_`)
 * - Description from first non-empty line of the file
 * - Content is the full file body (prompt template)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";

export interface CustomCommand {
	name: string;
	description: string;
	content: string;
	filePath: string;
}

/**
 * Recursively collect all .md files under a directory.
 */
function collectMdFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			results.push(...collectMdFiles(full));
		} else if (stat.isFile() && extname(entry) === ".md") {
			results.push(full);
		}
	}
	return results;
}

/**
 * Extract the first non-empty line from content as a description.
 */
function extractDescription(content: string, fallback: string): string {
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) {
			return trimmed.slice(0, 256);
		}
	}
	return fallback;
}

/**
 * Scan {workingDir}/.claude/commands/ for .md files and return custom commands.
 */
export function scanCustomCommands(workingDir: string): CustomCommand[] {
	const commandsDir = join(workingDir, ".claude", "commands");

	if (!existsSync(commandsDir)) {
		console.log(`No .claude/commands/ directory found at ${commandsDir}, skipping custom commands`);
		return [];
	}

	const mdFiles = collectMdFiles(commandsDir);
	if (mdFiles.length === 0) {
		console.log("No .md files found in .claude/commands/");
		return [];
	}

	const commands: CustomCommand[] = [];

	for (const filePath of mdFiles) {
		const rel = relative(commandsDir, filePath);
		// Convert path to command name: remove .md, replace path separators with _
		const name = rel
			.replace(/\.md$/, "")
			.replace(/[\\/]/g, "_")
			.toLowerCase();

		// Telegram command names: 1-32 chars, lowercase a-z, 0-9, underscores
		if (!/^[a-z0-9_]{1,32}$/.test(name)) {
			console.warn(`Skipping custom command "${rel}": invalid command name "${name}" (must be 1-32 lowercase alphanumeric/underscore chars)`);
			continue;
		}

		const content = readFileSync(filePath, "utf-8");
		const description = extractDescription(content, basename(filePath, ".md"));

		commands.push({ name, description, content, filePath });
	}

	return commands;
}
