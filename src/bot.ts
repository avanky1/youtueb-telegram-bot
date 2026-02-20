import http from "node:http";
import { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import type { Update } from "telegraf/types";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { cleanOldFiles } from "./utils/fileManager.js";
import { registerUrlHandler } from "./handlers/urlHandler.js";
import { registerQualityHandler } from "./handlers/qualityHandler.js";

function checkLocalApi(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

let useLocalApi = false;

async function createBot(): Promise<Telegraf<Context<Update>>> {
  if (config.localApiUrl) {
    logger.info(`Checking local Bot API at ${config.localApiUrl}...`);
    useLocalApi = await checkLocalApi(config.localApiUrl);
  }

  const telegrafOptions = useLocalApi
    ? { telegram: { apiRoot: config.localApiUrl }, handlerTimeout: config.downloadTimeoutMs }
    : { handlerTimeout: config.downloadTimeoutMs };

  return new Telegraf(config.botToken, telegrafOptions);
}

const bot = await createBot();

bot.start((ctx) =>
  ctx.reply(
    "🎬 *YouTube Downloader Bot*\n\n" +
      "Send me a YouTube link and I'll let you download it in your preferred quality\\!\n\n" +
      "📹 Video up to 1080p \\(with audio\\)\n" +
      "🎵 Audio\\-only MP3\n" +
      "📊 File size estimates\n" +
      "⚡ Fast downloads with progress tracking\n\n" +
      "Just paste a link to get started\\.",
    { parse_mode: "MarkdownV2" },
  ),
);

bot.help((ctx) =>
  ctx.reply(
    "📖 *How to use:*\n\n" +
      "1\\. Send a YouTube URL\n" +
      "2\\. See video info and available qualities\n" +
      "3\\. Choose a quality from the buttons\n" +
      "4\\. Wait for the download to complete\n" +
      "5\\. Receive the file right here\\!\n\n" +
      `📦 Max file size: ${config.maxFileSizeMB}MB`,
    { parse_mode: "MarkdownV2" },
  ),
);

registerUrlHandler(bot);
registerQualityHandler(bot);

bot.catch((err: unknown, _ctx: Context<Update>) => {
  const errMsg = err instanceof Error ? err.message : "Unknown error";
  logger.error(`Unhandled bot error: ${errMsg}`);
});

async function main(): Promise<void> {
  logger.info("Starting YouTube Downloader Bot...");

  if (useLocalApi) {
    logger.success(`Local Bot API connected: ${config.localApiUrl}`);
    logger.info(`Max file size: ${config.maxFileSizeMB}MB`);
  } else if (config.localApiUrl) {
    logger.warn(`Local Bot API at ${config.localApiUrl} is not reachable`);
    logger.warn("Falling back to default Telegram API (50MB upload limit)");
    logger.warn("Start your local Bot API server for 2GB uploads");
  } else {
    logger.warn("No LOCAL_API_URL — using default Telegram API (50MB limit)");
    logger.warn("Set LOCAL_API_URL in .env for large file uploads (up to 2GB)");
  }

  logger.info(`Max concurrent downloads: ${config.maxConcurrentDownloads}`);
  logger.info(`Download timeout: ${config.downloadTimeoutMs / 1000}s`);

  cleanOldFiles();

  await bot.launch();
  logger.success("Bot is running! Press Ctrl+C to stop.");
}

process.once("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down...");
  bot.stop("SIGTERM");
});

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
