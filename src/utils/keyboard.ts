import { Markup } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";
import type { FormatOption } from "../services/youtubeService.js";
import { formatBytes } from "./fileManager.js";

const QUALITY_EMOJI: Record<string, string> = {
  "1080": "🔵",
  "720": "🟢",
  "480": "🟡",
  "360": "🟠",
  "240": "🟤",
  "144": "⚫",
  best: "⚪",
};

export function buildQualityKeyboard(
  formats: FormatOption[],
  urlId: string,
): Markup.Markup<InlineKeyboardMarkup> {
  const buttons = formats.map((f) => {
    const emoji = QUALITY_EMOJI[f.quality] || "⚪";
    const sizeStr = f.estimatedSize > 0 ? ` — ~${formatBytes(f.estimatedSize)}` : "";
    return Markup.button.callback(
      `${emoji} ${f.label}${sizeStr}`,
      `dl:${f.quality}:${urlId}`,
    );
  });

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  rows.push([Markup.button.callback("🎵 Audio Only (MP3)", `audio:${urlId}`)]);

  return Markup.inlineKeyboard(rows);
}
