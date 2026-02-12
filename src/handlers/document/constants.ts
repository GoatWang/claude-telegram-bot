/**
 * Constants for document handler.
 */

// Supported text file extensions
export const TEXT_EXTENSIONS = [
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

// Supported archive extensions
export const ARCHIVE_EXTENSIONS = [".zip", ".tar", ".tar.gz", ".tgz"];

// Max file size (10MB)
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Max extracted archive size (100MB) - prevents decompression bombs
export const MAX_EXTRACTED_SIZE = 100 * 1024 * 1024;

// Max content from archive (50K chars total)
export const MAX_ARCHIVE_CONTENT = 50000;
