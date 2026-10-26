import fs from "fs";
import path from "path";
import type { LogCategory, LogEntry, LogLevel, LogSource } from "./types";

const LOGS_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOGS_DIR, "server.log");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function getLogFilePath(): string {
  return LOG_FILE;
}

function ensureLogsDir(): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("[serverLogger] Failed to create logs directory:", err);
  }
}

function rotateIfNeeded(): void {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size >= MAX_FILE_SIZE) {
        const backupFile = path.join(LOGS_DIR, "server.log.1");
        if (fs.existsSync(backupFile)) {
          fs.unlinkSync(backupFile);
        }
        fs.renameSync(LOG_FILE, backupFile);
      }
    }
  } catch (err) {
    console.error("[serverLogger] Failed to rotate log file:", err);
  }
}

export function writeServerLog(input: {
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: unknown;
  source?: LogSource;
  stack?: string;
}): LogEntry {
  const now = Date.now();
  const entry: LogEntry = {
    id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now,
    isoTime: new Date(now).toISOString(),
    level: input.level,
    category: input.category,
    message: input.message,
    details: input.details,
    source: input.source ?? "server",
    stack: input.stack,
  };

  try {
    ensureLogsDir();
    rotateIfNeeded();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (err) {
    console.error("[serverLogger] Failed to append server log:", err);
  }

  return entry;
}

export function readRecentServerLogs(limit = 200): LogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return [];
    }
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.trim().split("\n");
    const entries: LogEntry[] = [];

    const targetLines = lines.slice(-limit);
    for (const line of targetLines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as LogEntry;
        entries.push(parsed);
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  } catch (err) {
    console.error("[serverLogger] Failed to read server logs:", err);
    return [];
  }
}

export function clearServerLogs(): void {
  try {
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
    }
    const backupFile = path.join(LOGS_DIR, "server.log.1");
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
  } catch (err) {
    console.error("[serverLogger] Failed to clear server logs:", err);
  }
}
