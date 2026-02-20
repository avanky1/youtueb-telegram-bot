import { spawn } from "node:child_process";
import { logger } from "../utils/logger.js";

export interface FormatOption {
  quality: string;
  label: string;
  height: number;
  estimatedSize: number;
}

export interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: FormatOption[];
}

interface YtDlpFormat {
  format_id: string;
  height?: number;
  width?: number;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  vbr?: number;
  abr?: number;
  fps?: number;
}

interface YtDlpJson {
  title: string;
  thumbnail?: string;
  thumbnails?: Array<{ url: string }>;
  duration?: number;
  uploader?: string;
  formats?: YtDlpFormat[];
}

const QUALITY_TARGETS = [
  { height: 1080, label: "1080p Full HD" },
  { height: 720, label: "720p HD" },
  { height: 480, label: "480p SD" },
  { height: 360, label: "360p" },
  { height: 240, label: "240p" },
  { height: 144, label: "144p" },
];

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 500)}`));
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run yt-dlp: ${err.message}`));
    });
  });
}

function estimateFileSize(
  formats: YtDlpFormat[],
  targetHeight: number,
  duration: number,
): number {
  const videoFormats = formats.filter(
    (f) =>
      f.height &&
      f.height >= targetHeight - 30 &&
      f.height <= targetHeight + 30 &&
      f.vcodec &&
      f.vcodec !== "none",
  );

  if (videoFormats.length === 0) return 0;

  const bestVideo = videoFormats.reduce((a, b) => {
    const sizeA = a.filesize || a.filesize_approx || 0;
    const sizeB = b.filesize || b.filesize_approx || 0;
    if (sizeA > 0 && sizeB > 0) return sizeA > sizeB ? a : b;
    if (sizeA > 0) return a;
    if (sizeB > 0) return b;
    return (a.tbr || 0) > (b.tbr || 0) ? a : b;
  });

  let videoSize = bestVideo.filesize || bestVideo.filesize_approx || 0;

  if (videoSize === 0 && duration > 0) {
    const bitrate = bestVideo.tbr || bestVideo.vbr || 0;
    if (bitrate > 0) {
      videoSize = (bitrate * 1000 * duration) / 8;
    }
  }

  const audioFormats = formats.filter(
    (f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"),
  );

  let audioSize = 0;
  if (audioFormats.length > 0) {
    const bestAudio = audioFormats.reduce((a, b) => {
      const sizeA = a.filesize || a.filesize_approx || 0;
      const sizeB = b.filesize || b.filesize_approx || 0;
      if (sizeA > 0 && sizeB > 0) return sizeA > sizeB ? a : b;
      if (sizeA > 0) return a;
      if (sizeB > 0) return b;
      return (a.abr || a.tbr || 0) > (b.abr || b.tbr || 0) ? a : b;
    });
    audioSize = bestAudio.filesize || bestAudio.filesize_approx || 0;
    if (audioSize === 0 && duration > 0) {
      const abr = bestAudio.abr || bestAudio.tbr || 128;
      audioSize = (abr * 1000 * duration) / 8;
    }
  }

  return videoSize + audioSize;
}

export function isValidYoutubeUrl(text: string): boolean {
  const pattern =
    /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/|m\.youtube\.com\/watch\?v=)[\w-]+/;
  return pattern.test(text.trim());
}

export function extractYoutubeUrl(text: string): string | null {
  const pattern =
    /(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/|m\.youtube\.com\/watch\?v=)[\w-]+(&[\w=%+-]*)*/;
  const match = text.match(pattern);
  if (!match) return null;
  let url = match[0];
  if (!url.startsWith("http")) url = "https://" + url;
  return url;
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const raw = await runProcess("yt-dlp", [
    "--dump-json",
    "--no-warnings",
    "--no-playlist",
    url,
  ]);

  const data: YtDlpJson = JSON.parse(raw);
  const duration = data.duration || 0;

  const availableHeights = new Set<number>();
  if (data.formats) {
    for (const f of data.formats) {
      if (f.height && f.vcodec && f.vcodec !== "none") {
        availableHeights.add(f.height);
      }
    }
  }

  const formats: FormatOption[] = [];

  for (const target of QUALITY_TARGETS) {
    const match = [...availableHeights].find(
      (h) => h >= target.height - 30 && h <= target.height + 30,
    );

    if (match) {
      const estimated = data.formats
        ? estimateFileSize(data.formats, target.height, duration)
        : 0;

      formats.push({
        quality: String(target.height),
        label: target.label,
        height: target.height,
        estimatedSize: estimated,
      });
    }
  }

  if (formats.length === 0) {
    formats.push({
      quality: "best",
      label: "Best Available",
      height: 0,
      estimatedSize: 0,
    });
  }

  const thumbnail =
    data.thumbnail ||
    (data.thumbnails && data.thumbnails.length > 0
      ? data.thumbnails[data.thumbnails.length - 1].url
      : "");

  logger.info(`Fetched info: "${data.title}" | ${formats.length} quality option(s)`);

  return {
    title: data.title,
    thumbnail: thumbnail || "",
    duration,
    uploader: data.uploader || "Unknown",
    formats,
  };
}
