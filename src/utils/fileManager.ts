import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "./logger.js";

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getDownloadDir(): string {
  ensureDir(config.downloadDir);
  return config.downloadDir;
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

export function cleanFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.debug(`Cleaned: ${filePath}`);
    }
  } catch {
    logger.warn(`Failed to clean: ${filePath}`);
  }
}

export function cleanOldFiles(maxAgeMs: number = 3600_000): void {
  const dir = getDownloadDir();
  try {
    const files = fs.readdirSync(dir);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          cleaned++;
        }
      } catch {
        // skip
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} old file(s) from downloads`);
    }
  } catch {
    logger.warn("Failed to clean old files");
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
