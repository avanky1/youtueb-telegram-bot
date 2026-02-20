import type { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import type { Update } from "telegraf/types";
import { logger } from "../utils/logger.js";
import { extractYoutubeUrl } from "../services/youtubeService.js";
import { getVideoInfo, type VideoInfo } from "../services/youtubeService.js";
import { buildQualityKeyboard } from "../utils/keyboard.js";
import { formatDuration } from "../utils/fileManager.js";

export interface StoredUrl {
  url: string;
  info: VideoInfo;
}

const urlStore = new Map<string, StoredUrl>();

export function getStoredUrl(urlId: string): StoredUrl | undefined {
  return urlStore.get(urlId);
}

function generateUrlId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export function registerUrlHandler(bot: Telegraf<Context<Update>>): void {
  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const url = extractYoutubeUrl(text);
    if (!url) {
      await ctx.reply("⚠️ That doesn't look like a valid YouTube URL. Please send a YouTube link.");
      return;
    }

    const processingMsg = await ctx.reply("🔍 Fetching video info...");

    try {
      const info = await getVideoInfo(url);
      const urlId = generateUrlId();
      urlStore.set(urlId, { url, info });

      setTimeout(() => urlStore.delete(urlId), 30 * 60 * 1000);

      const caption =
        `🎬 *${escapeMarkdown(info.title)}*\n\n` +
        `👤 ${escapeMarkdown(info.uploader)}\n` +
        `⏱ ${formatDuration(info.duration)}\n` +
        `📹 ${info.formats.length} quality option${info.formats.length > 1 ? "s" : ""} available\n\n` +
        `Choose a quality:`;

      const keyboard = buildQualityKeyboard(info.formats, urlId);

      if (info.thumbnail) {
        try {
          await ctx.replyWithPhoto(info.thumbnail, {
            caption,
            parse_mode: "MarkdownV2",
            ...keyboard,
          });
        } catch {
          await ctx.reply(caption, { parse_mode: "MarkdownV2", ...keyboard });
        }
      } else {
        await ctx.reply(caption, { parse_mode: "MarkdownV2", ...keyboard });
      }

      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => {});
      logger.info(`Video info sent: "${info.title}" for user ${ctx.from.id}`);
    } catch (err) {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => {});
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      logger.error(`Failed to fetch video info: ${errMsg}`);
      await ctx.reply("❌ Could not fetch video info. Please check the URL and try again.");
    }
  });
}
