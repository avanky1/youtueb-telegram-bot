import type { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import type { Update } from "telegraf/types";
import fs from "node:fs";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { formatBytes, cleanFile } from "../utils/fileManager.js";
import { downloadVideo, downloadAudio, downloadQueue, type DownloadState } from "../services/downloadService.js";
import { getStoredUrl } from "./urlHandler.js";

const activeDownloads = new Set<number>();

const STATE_LABELS: Record<DownloadState, string> = {
  fetching: "🔍 Fetching info...",
  downloading: "⬇️ Downloading",
  merging: "🔄 Merging audio & video...",
  uploading: "📤 Uploading to Telegram...",
  done: "✅ Done!",
  error: "❌ Error",
};

function buildProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function buildProgressText(
  state: DownloadState,
  percent: number,
  speed: string,
  isAudio: boolean,
): string {
  const icon = isAudio ? "🎵" : "📹";

  if (state === "merging") return "🔄 Merging audio & video...";
  if (state === "uploading") return "📤 Uploading to Telegram...";

  const bar = buildProgressBar(percent);
  const speedStr = speed ? ` | ${speed}` : "";
  return `${icon} ${STATE_LABELS[state] || "Processing"}: ${bar} ${percent.toFixed(1)}%${speedStr}`;
}

export function registerQualityHandler(bot: Telegraf<Context<Update>>): void {
  bot.action(/^dl:(.+):(.+)$/, async (ctx) => {
    const quality = ctx.match[1];
    const urlId = ctx.match[2];
    const userId = ctx.from.id;

    await ctx.answerCbQuery();

    const stored = getStoredUrl(urlId);
    if (!stored) {
      await ctx.editMessageCaption("⚠️ This link has expired. Please send the URL again.");
      return;
    }

    if (activeDownloads.has(userId)) {
      await ctx.reply("⏳ You already have a download in progress. Please wait for it to finish.");
      return;
    }

    activeDownloads.add(userId);
    const statusMsg = await ctx.reply(`⬇️ Starting ${quality}p download...\n\n${downloadQueue.activeCount > 0 ? `📋 Queue: ${downloadQueue.pendingCount} pending` : ""}`);
    let lastProgressUpdate = 0;

    try {
      await downloadQueue.enqueue(async () => {
        const result = await downloadVideo(stored.url, quality, (percent, speed, state) => {
          const now = Date.now();
          if (now - lastProgressUpdate < 3000) return;
          lastProgressUpdate = now;

          const text = buildProgressText(state, percent, speed, false);
          ctx.telegram
            .editMessageText(ctx.chat!.id, statusMsg.message_id, undefined, text)
            .catch(() => {});
        });

        const stats = fs.statSync(result.filePath);

        if (stats.size > config.maxFileSizeBytes) {
          cleanFile(result.filePath);
          await ctx.telegram.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            undefined,
            `❌ File too large (${formatBytes(stats.size)}). Max allowed: ${config.maxFileSizeMB}MB.\n\nTry a lower quality.`,
          );
          return;
        }

        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          `📤 Uploading to Telegram... (${formatBytes(stats.size)})`,
        );

        await ctx.replyWithVideo(
          { source: result.filePath, filename: result.filename },
          { caption: `🎬 ${stored.info.title}\n📹 ${quality}p | ${formatBytes(stats.size)}` },
        );

        await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
        cleanFile(result.filePath);
        logger.success(`Video sent: "${stored.info.title}" (${quality}p, ${formatBytes(stats.size)}) → user ${userId}`);
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      logger.error(`Download failed for user ${userId}: ${errMsg}`);
      await ctx.telegram
        .editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          "❌ Download failed. Please try again later.",
        )
        .catch(() => {});
    } finally {
      activeDownloads.delete(userId);
    }
  });

  bot.action(/^audio:(.+)$/, async (ctx) => {
    const urlId = ctx.match[1];
    const userId = ctx.from.id;

    await ctx.answerCbQuery();

    const stored = getStoredUrl(urlId);
    if (!stored) {
      await ctx.editMessageCaption("⚠️ This link has expired. Please send the URL again.");
      return;
    }

    if (activeDownloads.has(userId)) {
      await ctx.reply("⏳ You already have a download in progress. Please wait for it to finish.");
      return;
    }

    activeDownloads.add(userId);
    const statusMsg = await ctx.reply("🎵 Starting audio download...");
    let lastProgressUpdate = 0;

    try {
      await downloadQueue.enqueue(async () => {
        const result = await downloadAudio(stored.url, (percent, speed, state) => {
          const now = Date.now();
          if (now - lastProgressUpdate < 3000) return;
          lastProgressUpdate = now;

          const text = buildProgressText(state, percent, speed, true);
          ctx.telegram
            .editMessageText(ctx.chat!.id, statusMsg.message_id, undefined, text)
            .catch(() => {});
        });

        const stats = fs.statSync(result.filePath);

        if (stats.size > config.maxFileSizeBytes) {
          cleanFile(result.filePath);
          await ctx.telegram.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            undefined,
            `❌ File too large (${formatBytes(stats.size)}). Max: ${config.maxFileSizeMB}MB.`,
          );
          return;
        }

        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          `📤 Uploading audio... (${formatBytes(stats.size)})`,
        );

        await ctx.replyWithAudio(
          { source: result.filePath, filename: result.filename },
          { caption: `🎵 ${stored.info.title}` },
        );

        await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
        cleanFile(result.filePath);
        logger.success(`Audio sent: "${stored.info.title}" (${formatBytes(stats.size)}) → user ${userId}`);
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      logger.error(`Audio download failed for user ${userId}: ${errMsg}`);
      await ctx.telegram
        .editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          "❌ Audio download failed. Please try again later.",
        )
        .catch(() => {});
    } finally {
      activeDownloads.delete(userId);
    }
  });
}
