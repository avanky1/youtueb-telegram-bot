import "dotenv/config";

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  downloadDir: optional("DOWNLOAD_DIR", "./downloads"),
  maxFileSizeMB: optionalInt("MAX_FILE_SIZE_MB", 2000),
  maxConcurrentDownloads: optionalInt("MAX_CONCURRENT_DOWNLOADS", 3),
  downloadTimeoutMs: optionalInt("DOWNLOAD_TIMEOUT_MS", 600_000),
  localApiUrl: process.env["LOCAL_API_URL"] || "",
  cookiesPath: optional("COOKIES_PATH", "/app/cookies.txt"),
  get maxFileSizeBytes(): number {
    return this.maxFileSizeMB * 1024 * 1024;
  },
} as const;
