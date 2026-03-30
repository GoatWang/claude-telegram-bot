import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const DEFAULT_ENV_FILE = ".env";
export const DEFAULT_CLAUDE_CODE_PATH = "~/.local/bin/claude";

const HOME = homedir();

export function resolveEnvFilePath(
	dir: string,
	envFile = DEFAULT_ENV_FILE,
): string {
	return resolve(dir, envFile || DEFAULT_ENV_FILE);
}

export function resolveSelectedEnvFile(
	dir: string,
	envFile: string | undefined,
	env: NodeJS.ProcessEnv,
): { envName: string; envPath: string } {
	const envName = envFile || env.CTB_ENV || DEFAULT_ENV_FILE;

	return {
		envName,
		envPath: resolveEnvFilePath(dir, envName),
	};
}

export function resolveInstanceKey(
	dir: string,
	envFile = DEFAULT_ENV_FILE,
): string {
	const workingDir = resolve(dir);
	const envPath = resolveEnvFilePath(workingDir, envFile);
	const defaultEnvPath = resolveEnvFilePath(workingDir, DEFAULT_ENV_FILE);

	// Preserve legacy storage paths for the default .env, while isolating
	// custom env files such as .env1/.env2 in the same working directory.
	if (envPath === defaultEnvPath) {
		return workingDir;
	}

	return `${workingDir}::${envPath}`;
}

export function expandHomePath(pathValue: string): string {
	return pathValue.replace(/^~(?=\/|$)/, HOME);
}

export function ensureClaudeCodePath(env: NodeJS.ProcessEnv): void {
	const configuredPath =
		env.CLAUDE_CODE_PATH ||
		env.CLAUDE_CLI_PATH ||
		DEFAULT_CLAUDE_CODE_PATH;
	const normalizedPath = expandHomePath(configuredPath);

	env.CLAUDE_CODE_PATH = normalizedPath;

	if (!env.CLAUDE_CLI_PATH) {
		env.CLAUDE_CLI_PATH = normalizedPath;
	}
}

export function loadEnvFile(
	dir: string,
	envFile = DEFAULT_ENV_FILE,
): Record<string, string> {
	const envPath = resolveEnvFilePath(dir, envFile);
	const env: Record<string, string> = {};

	if (!existsSync(envPath)) {
		return env;
	}

	const content = readFileSync(envPath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;

		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();

		// Remove quotes if present
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		env[key] = value;
	}

	return env;
}

export function saveEnvFile(
	dir: string,
	env: Record<string, string>,
	envFile = DEFAULT_ENV_FILE,
): void {
	const envPath = resolveEnvFilePath(dir, envFile);
	const lines: string[] = [];

	// Preserve existing content
	if (existsSync(envPath)) {
		const existing = readFileSync(envPath, "utf-8");
		const existingKeys = new Set<string>();

		for (const line of existing.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) {
				lines.push(line);
				continue;
			}

			const eqIndex = trimmed.indexOf("=");
			if (eqIndex !== -1) {
				const key = trimmed.slice(0, eqIndex).trim();
				existingKeys.add(key);
				// Use new value if provided, otherwise keep original
				if (key in env) {
					lines.push(`${key}=${env[key]}`);
				} else {
					lines.push(line);
				}
			} else {
				lines.push(line);
			}
		}

		// Add new keys not in existing file
		for (const [key, value] of Object.entries(env)) {
			if (!existingKeys.has(key)) {
				lines.push(`${key}=${value}`);
			}
		}
	} else {
		// New file
		for (const [key, value] of Object.entries(env)) {
			lines.push(`${key}=${value}`);
		}
	}

	writeFileSync(envPath, `${lines.join("\n")}\n`);
}
