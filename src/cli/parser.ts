export interface CliOptions {
	token?: string;
	users?: string;
	dir?: string;
	help?: boolean;
	version?: boolean;
	tut?: boolean;
}

export function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {};

	for (const arg of args) {
		if (arg === "--help" || arg === "-h" || arg === "help") {
			options.help = true;
		} else if (arg === "--version" || arg === "-v" || arg === "version") {
			options.version = true;
		} else if (arg === "tut" || arg === "tutorial") {
			options.tut = true;
		} else if (arg.startsWith("--token=")) {
			options.token = arg.slice(8);
		} else if (arg.startsWith("--users=")) {
			options.users = arg.slice(8);
		} else if (arg.startsWith("--dir=")) {
			options.dir = arg.slice(6);
		}
	}

	return options;
}
