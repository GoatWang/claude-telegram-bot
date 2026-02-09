import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { saveEnvFile } from "./env";

export async function prompt(question: string): Promise<string> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

export async function interactiveSetup(
	dir: string,
	existingEnv: Record<string, string>,
): Promise<{ token: string; users: string }> {
	console.log(`\nNo .env found or missing required variables in ${dir}\n`);

	let token = existingEnv.TELEGRAM_BOT_TOKEN || "";
	let users = existingEnv.TELEGRAM_ALLOWED_USERS || "";

	if (!token) {
		console.log("Get a bot token from @BotFather on Telegram");
		token = await prompt("Enter TELEGRAM_BOT_TOKEN: ");
		if (!token) {
			console.error("Token is required");
			process.exit(1);
		}
	}

	if (!users) {
		console.log(
			"\nEnter your Telegram user ID(s). Find yours by messaging @userinfobot",
		);
		users = await prompt("Enter TELEGRAM_ALLOWED_USERS (comma-separated): ");
		if (!users) {
			console.error("At least one user ID is required");
			process.exit(1);
		}
	}

	// Ask to save
	const save = await prompt("\nSave to .env? (Y/n): ");
	if (save.toLowerCase() !== "n") {
		saveEnvFile(dir, {
			...existingEnv,
			TELEGRAM_BOT_TOKEN: token,
			TELEGRAM_ALLOWED_USERS: users,
		});
		console.log(`Saved to ${resolve(dir, ".env")}\n`);
	}

	return { token, users };
}

/**
 * Ensure .claude directory exists with proper configuration.
 * Creates .claude/skills/ directory and CLAUDE.md if they don't exist.
 */
export function ensureClaudeConfig(workingDir: string): void {
	const claudeDir = join(workingDir, ".claude");
	const skillsDir = join(claudeDir, "skills");
	const claudeMdPath = join(claudeDir, "CLAUDE.md");

	// Create .claude/skills/ directory
	if (!existsSync(skillsDir)) {
		mkdirSync(skillsDir, { recursive: true });
		console.log(`✅ Created .claude/skills/ directory`);
	}

	// Create .claude/CLAUDE.md if it doesn't exist
	if (!existsSync(claudeMdPath)) {
		const claudeMdContent = `# Project Configuration for Claude Code

This file provides guidance to Claude Code when working on this project.

## Skills Location

**IMPORTANT**: When adding skills to this project, use the local \`.claude/skills/\` directory:

\`\`\`bash
# Correct - Project-local skills
.claude/skills/my-skill.md

# Wrong - Global skills (DO NOT USE)
~/.claude/skills/my-skill.md
\`\`\`

**Why local?** Skills are project-specific and should be version-controlled with your code.

## Working with this Project

This project uses the Claude Telegram Bot (ctb) to enable Claude Code access via Telegram.

- Working directory: ${workingDir}
- Skills location: ${skillsDir}

Add project-specific instructions, patterns, or guidelines below:

---

`;

		writeFileSync(claudeMdPath, claudeMdContent, "utf-8");
		console.log(`✅ Created .claude/CLAUDE.md with skills configuration`);
	}
}
