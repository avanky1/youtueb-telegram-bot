import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getDownloadDir, generateId, cleanFile } from "../utils/fileManager.js";

export type DownloadState = "fetching" | "downloading" | "merging" | "uploading" | "done" | "error";

export type ProgressCallback = (
  percent: number,
  speed: string,
  state: DownloadState,
) => void;

interface QueueItem {
  id: string;
  execute: () => Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

class DownloadQueue {
  private queue: QueueItem[] = [];
  private running = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue(fn: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const id = Math.random().toString(36).slice(2, 8);
      this.queue.push({ id, execute: fn, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;

    const item = this.queue.shift()!;
    this.running++;
    logger.debug(`Queue: running=${this.running}, pending=${this.queue.length}`);

    try {
      await item.execute();
      item.resolve();
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running--;
      this.processNext();
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.running;
  }
}

export const downloadQueue = new DownloadQueue(config.maxConcurrentDownloads);

function spawnWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
): { proc: ChildProcessWithoutNullStreams; kill: () => void } {
  const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

  const timer = setTimeout(() => {
    logger.warn(`Process timed out after ${timeoutMs}ms, killing...`);
    proc.kill("SIGKILL");
  }, timeoutMs);

  proc.on("close", () => clearTimeout(timer));
  proc.on("error", () => clearTimeout(timer));

  return {
    proc,
    kill: () => {
      clearTimeout(timer);
      proc.kill("SIGKILL");
    },
  };
}

export async function downloadVideo(
  url: string,
  quality: string,
  onProgress?: ProgressCallback,
  retries = 2,
): Promise<{ filePath: string; filename: string }> {
  const downloadDir = getDownloadDir();
  const id = generateId();
  const outputTemplate = path.join(downloadDir, `${id}_%(title).50s.%(ext)s`);

  let formatStr: string;
  if (quality === "best") {
    formatStr = "bestvideo+bestaudio/best";
  } else {
    const h = parseInt(quality, 10);
    formatStr = `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`;
  }

  const args = [
    "-f", formatStr,
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--progress-template", "%(progress._percent_str)s %(progress._speed_str)s",
    "-o", outputTemplate,
    url,
  ];

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await runDownload(args, id, downloadDir, ".mp4", "downloading", onProgress);
    } catch (err) {
      if (attempt < retries) {
        logger.warn(`Download attempt ${attempt + 1} failed, retrying... (${err instanceof Error ? err.message : err})`);
        cleanDownloadFiles(downloadDir, id);
        await sleep(2000);
      } else {
        throw err;
      }
    }
  }

  throw new Error("Download failed after all retries");
}

export async function downloadAudio(
  url: string,
  onProgress?: ProgressCallback,
  retries = 2,
): Promise<{ filePath: string; filename: string }> {
  const downloadDir = getDownloadDir();
  const id = generateId();
  const outputTemplate = path.join(downloadDir, `${id}_%(title).50s.%(ext)s`);

  const args = [
    "-f", "bestaudio",
    "--extract-audio",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--progress-template", "%(progress._percent_str)s %(progress._speed_str)s",
    "-o", outputTemplate,
    url,
  ];

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await runDownload(args, id, downloadDir, ".mp3", "downloading", onProgress);
    } catch (err) {
      if (attempt < retries) {
        logger.warn(`Audio download attempt ${attempt + 1} failed, retrying...`);
        cleanDownloadFiles(downloadDir, id);
        await sleep(2000);
      } else {
        throw err;
      }
    }
  }

  throw new Error("Audio download failed after all retries");
}

function runDownload(
  args: string[],
  id: string,
  downloadDir: string,
  ext: string,
  initialState: DownloadState,
  onProgress?: ProgressCallback,
): Promise<{ filePath: string; filename: string }> {
  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout("yt-dlp", args, config.downloadTimeoutMs);
    let currentState: DownloadState = initialState;

    onProgress?.(0, "", currentState);

    proc.stdout.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.includes("[Merger]") || trimmed.includes("Merging")) {
          currentState = "merging";
          onProgress?.(99, "", currentState);
        }

        if (trimmed.match(/[\d.]+%/)) {
          const percentMatch = trimmed.match(/([\d.]+)%/);
          const speedMatch = trimmed.match(/[\d.]+\s*[KMGT]?i?B\/s/);
          if (percentMatch) {
            const percent = parseFloat(percentMatch[1]);
            const speed = speedMatch ? speedMatch[0] : "";
            onProgress?.(percent, speed, currentState);
          }
        }
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text && !text.includes("WARNING")) {
        logger.debug(`yt-dlp: ${text.slice(0, 200)}`);
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}`));
        return;
      }

      const files = fs
        .readdirSync(downloadDir)
        .filter((f: string) => f.startsWith(id) && f.endsWith(ext))
        .map((f: string) => path.join(downloadDir, f));

      if (files.length === 0) {
        reject(new Error("Download completed but no output file found"));
        return;
      }

      const filePath = files[0];
      const filename = path.basename(filePath);
      resolve({ filePath, filename });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });
  });
}

function cleanDownloadFiles(dir: string, id: string): void {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(id));
    for (const file of files) {
      cleanFile(path.join(dir, file));
    }
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
