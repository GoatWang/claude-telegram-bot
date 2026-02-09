import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(dir: string): Record<string, string> {
	const envPath = resolve(dir, ".env");
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

export function saveEnvFile(dir: string, env: Record<string, string>): void {
	const envPath = resolve(dir, ".env");
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
