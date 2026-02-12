/**
 * Unit tests for CLI parser (src/cli/parser.ts) and env file handling (src/cli/env.ts).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../cli/parser";
import { loadEnvFile, saveEnvFile } from "../cli/env";

// ============== parseArgs Tests ==============

describe("parseArgs", () => {
	describe("flags", () => {
		test("parses --help flag", () => {
			expect(parseArgs(["--help"])).toEqual({ help: true });
		});

		test("parses -h shorthand", () => {
			expect(parseArgs(["-h"])).toEqual({ help: true });
		});

		test("parses 'help' as help flag", () => {
			expect(parseArgs(["help"])).toEqual({ help: true });
		});

		test("parses --version flag", () => {
			expect(parseArgs(["--version"])).toEqual({ version: true });
		});

		test("parses -v shorthand", () => {
			expect(parseArgs(["-v"])).toEqual({ version: true });
		});

		test("parses 'version' as version flag", () => {
			expect(parseArgs(["version"])).toEqual({ version: true });
		});

		test("parses 'tut' command", () => {
			expect(parseArgs(["tut"])).toEqual({ tut: true });
		});

		test("parses 'tutorial' command", () => {
			expect(parseArgs(["tutorial"])).toEqual({ tut: true });
		});
	});

	describe("options with values", () => {
		test("parses --token option", () => {
			const result = parseArgs(["--token=my-bot-token"]);
			expect(result.token).toBe("my-bot-token");
		});

		test("parses --users option", () => {
			const result = parseArgs(["--users=123,456,789"]);
			expect(result.users).toBe("123,456,789");
		});

		test("parses --dir option", () => {
			const result = parseArgs(["--dir=/path/to/project"]);
			expect(result.dir).toBe("/path/to/project");
		});

		test("handles token with special characters", () => {
			const result = parseArgs(["--token=123:ABC-xyz_789"]);
			expect(result.token).toBe("123:ABC-xyz_789");
		});

		test("handles path with spaces", () => {
			const result = parseArgs(["--dir=/path/with spaces/project"]);
			expect(result.dir).toBe("/path/with spaces/project");
		});
	});

	describe("multiple options", () => {
		test("parses multiple options together", () => {
			const result = parseArgs([
				"--token=token123",
				"--users=111,222",
				"--dir=/home/user/project",
			]);
			expect(result.token).toBe("token123");
			expect(result.users).toBe("111,222");
			expect(result.dir).toBe("/home/user/project");
		});

		test("parses flags with options", () => {
			const result = parseArgs(["--help", "--token=abc"]);
			expect(result.help).toBe(true);
			expect(result.token).toBe("abc");
		});
	});

	describe("edge cases", () => {
		test("handles empty args array", () => {
			expect(parseArgs([])).toEqual({});
		});

		test("ignores unknown flags", () => {
			const result = parseArgs(["--unknown", "--another=value"]);
			expect(result).toEqual({});
		});

		test("handles empty token value", () => {
			const result = parseArgs(["--token="]);
			expect(result.token).toBe("");
		});

		test("handles empty users value", () => {
			const result = parseArgs(["--users="]);
			expect(result.users).toBe("");
		});

		test("handles empty dir value", () => {
			const result = parseArgs(["--dir="]);
			expect(result.dir).toBe("");
		});

		test("handles duplicate flags", () => {
			const result = parseArgs(["--help", "--help"]);
			expect(result.help).toBe(true);
		});

		test("last value wins for duplicate options", () => {
			const result = parseArgs(["--token=first", "--token=second"]);
			expect(result.token).toBe("second");
		});

		test("does not parse partial flag matches", () => {
			const result = parseArgs(["--hel", "--ver"]);
			expect(result.help).toBeUndefined();
			expect(result.version).toBeUndefined();
		});

		test("handles options without = sign", () => {
			// These should not be parsed as options
			const result = parseArgs(["--token", "my-token"]);
			// --token without = is not parsed, and "my-token" is unknown
			expect(result.token).toBeUndefined();
		});
	});
});

// ============== loadEnvFile Tests ==============

describe("loadEnvFile", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = `/tmp/ctb-env-test-${Date.now()}`;
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		try {
			const envPath = join(testDir, ".env");
			if (existsSync(envPath)) unlinkSync(envPath);
			rmdirSync(testDir);
		} catch {
			// Ignore cleanup errors
		}
	});

	test("parses simple key=value pairs", () => {
		writeFileSync(join(testDir, ".env"), "KEY1=value1\nKEY2=value2\n");

		const env = loadEnvFile(testDir);
		expect(env.KEY1).toBe("value1");
		expect(env.KEY2).toBe("value2");
	});

	test("ignores comments", () => {
		writeFileSync(
			join(testDir, ".env"),
			"# This is a comment\nKEY=value\n# Another comment\n",
		);

		const env = loadEnvFile(testDir);
		expect(Object.keys(env)).toHaveLength(1);
		expect(env.KEY).toBe("value");
	});

	test("ignores empty lines", () => {
		writeFileSync(join(testDir, ".env"), "KEY1=value1\n\n\nKEY2=value2\n\n");

		const env = loadEnvFile(testDir);
		expect(Object.keys(env)).toHaveLength(2);
	});

	test("removes double quotes from values", () => {
		writeFileSync(join(testDir, ".env"), 'KEY="quoted value"\n');

		const env = loadEnvFile(testDir);
		expect(env.KEY).toBe("quoted value");
	});

	test("removes single quotes from values", () => {
		writeFileSync(join(testDir, ".env"), "KEY='single quoted'\n");

		const env = loadEnvFile(testDir);
		expect(env.KEY).toBe("single quoted");
	});

	test("handles values with equals signs", () => {
		writeFileSync(join(testDir, ".env"), "API_KEY=key=with=equals\n");

		const env = loadEnvFile(testDir);
		expect(env.API_KEY).toBe("key=with=equals");
	});

	test("trims keys and values", () => {
		writeFileSync(join(testDir, ".env"), "  KEY  =  value  \n");

		const env = loadEnvFile(testDir);
		expect(env.KEY).toBe("value");
	});

	test("returns empty object for missing file", () => {
		const env = loadEnvFile(testDir);
		expect(env).toEqual({});
	});

	test("returns empty object for empty file", () => {
		writeFileSync(join(testDir, ".env"), "");

		const env = loadEnvFile(testDir);
		expect(env).toEqual({});
	});

	test("skips lines without = sign", () => {
		writeFileSync(join(testDir, ".env"), "INVALID_LINE\nKEY=value\n");

		const env = loadEnvFile(testDir);
		expect(Object.keys(env)).toHaveLength(1);
		expect(env.KEY).toBe("value");
	});

	test("handles values that are only quotes", () => {
		writeFileSync(join(testDir, ".env"), "KEY=\"\"\nKEY2=''\n");

		const env = loadEnvFile(testDir);
		expect(env.KEY).toBe("");
		expect(env.KEY2).toBe("");
	});

	test("does not strip quotes from partially quoted values", () => {
		writeFileSync(join(testDir, ".env"), "KEY=\"partial\nKEY2='no end\n");

		const env = loadEnvFile(testDir);
		// Value starts with " but doesn't end with " -> keeps quotes
		expect(env.KEY).toBe('"partial');
		expect(env.KEY2).toBe("'no end");
	});
});

// ============== saveEnvFile Tests ==============

describe("saveEnvFile", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = `/tmp/ctb-env-save-test-${Date.now()}`;
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		try {
			const envPath = join(testDir, ".env");
			if (existsSync(envPath)) unlinkSync(envPath);
			rmdirSync(testDir);
		} catch {
			// Ignore cleanup errors
		}
	});

	test("creates new env file with entries", () => {
		saveEnvFile(testDir, { KEY1: "value1", KEY2: "value2" });

		const content = readFileSync(join(testDir, ".env"), "utf-8");
		expect(content).toContain("KEY1=value1");
		expect(content).toContain("KEY2=value2");
	});

	test("preserves existing comments", () => {
		writeFileSync(
			join(testDir, ".env"),
			"# Important comment\nKEY=old_value\n",
		);

		saveEnvFile(testDir, { KEY: "new_value" });

		const content = readFileSync(join(testDir, ".env"), "utf-8");
		expect(content).toContain("# Important comment");
		expect(content).toContain("KEY=new_value");
		expect(content).not.toContain("old_value");
	});

	test("preserves existing keys not in new env", () => {
		writeFileSync(join(testDir, ".env"), "EXISTING=keep_me\nUPDATE=old\n");

		saveEnvFile(testDir, { UPDATE: "new" });

		const content = readFileSync(join(testDir, ".env"), "utf-8");
		expect(content).toContain("EXISTING=keep_me");
		expect(content).toContain("UPDATE=new");
	});

	test("adds new keys not in existing file", () => {
		writeFileSync(join(testDir, ".env"), "EXISTING=value\n");

		saveEnvFile(testDir, { NEW_KEY: "new_value" });

		const content = readFileSync(join(testDir, ".env"), "utf-8");
		expect(content).toContain("EXISTING=value");
		expect(content).toContain("NEW_KEY=new_value");
	});

	test("preserves empty lines in existing file", () => {
		writeFileSync(join(testDir, ".env"), "KEY1=value1\n\nKEY2=value2\n");

		saveEnvFile(testDir, { KEY1: "updated" });

		const content = readFileSync(join(testDir, ".env"), "utf-8");
		expect(content).toContain("KEY1=updated");
		expect(content).toContain("KEY2=value2");
	});

	test("handles empty env object with existing file", () => {
		writeFileSync(join(testDir, ".env"), "KEY=value\n");

		saveEnvFile(testDir, {});

		const content = readFileSync(join(testDir, ".env"), "utf-8");
		expect(content).toContain("KEY=value");
	});

	test("creates file with trailing newline", () => {
		saveEnvFile(testDir, { KEY: "value" });

		const content = readFileSync(join(testDir, ".env"), "utf-8");
		expect(content.endsWith("\n")).toBe(true);
	});

	test("roundtrips with loadEnvFile", () => {
		const original = {
			TOKEN: "abc123",
			USERS: "1,2,3",
			DIR: "/home/user",
		};

		saveEnvFile(testDir, original);
		const loaded = loadEnvFile(testDir);

		expect(loaded.TOKEN).toBe("abc123");
		expect(loaded.USERS).toBe("1,2,3");
		expect(loaded.DIR).toBe("/home/user");
	});
});
