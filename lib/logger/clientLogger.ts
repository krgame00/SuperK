import type { LogCategory, LogEntry, LogLevel, LogSource } from "./types";

const STORAGE_KEY = "superk_system_logs";
const DEFAULT_MAX_ENTRIES = 500;

class ClientLogger {
  private entries: LogEntry[] = [];
  private maxEntries: number = DEFAULT_MAX_ENTRIES;
  private subscribers: Set<(entry: LogEntry) => void> = new Set();
  private isBrowser: boolean;

  constructor() {
    this.isBrowser = typeof window !== "undefined";
    this.hydrateFromStorage();
    this.setupGlobalHandlers();
  }

  public setMaxEntries(max: number): void {
    this.maxEntries = Math.max(10, max);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
  }

  private hydrateFromStorage(): void {
    if (!this.isBrowser) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed.slice(-this.maxEntries);
        }
      }
    } catch {
      // Storage unavailable or invalid JSON
    }
  }

  private persistToStorage(): void {
    if (!this.isBrowser) return;
    try {
      // Keep only last 100 entries in localStorage to avoid quota limits
      const toStore = this.entries.slice(-100);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // Ignore quota errors
    }
  }

  private setupGlobalHandlers(): void {
    if (!this.isBrowser) return;

    window.addEventListener("error", (event) => {
      this.log({
        level: "error",
        category: "system",
        message: event.message || "Uncaught window error",
        details: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
        stack: event.error?.stack,
        source: "client",
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const message =
        typeof reason === "string"
          ? reason
          : reason?.message || "Unhandled Promise Rejection";
      const stack = reason?.stack;
      this.log({
        level: "error",
        category: "system",
        message,
        details: reason && typeof reason === "object" ? this.safeSerialize(reason) : undefined,
        stack,
        source: "client",
      });
    });
  }

  private safeSerialize(val: unknown): unknown {
    try {
      const seen = new WeakSet();
      return JSON.parse(
        JSON.stringify(val, (key, value) => {
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return "[Circular]";
            seen.add(value);
          }
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          return value;
        })
      );
    } catch {
      return String(val);
    }
  }

  public log(input: {
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
      details: input.details ? this.safeSerialize(input.details) : undefined,
      source: input.source ?? "client",
      stack: input.stack,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.persistToStorage();

    for (const listener of this.subscribers) {
      try {
        listener(entry);
      } catch {}
    }

    return entry;
  }

  public getEntries(): LogEntry[] {
    return [...this.entries];
  }

  public clear(): void {
    this.entries = [];
    if (this.isBrowser) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
  }

  public subscribe(callback: (entry: LogEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  public exportAsText(): string {
    return this.entries
      .map((e) => {
        const time = e.isoTime.replace("T", " ").replace("Z", "");
        const detailsStr = e.details ? `\nDetails: ${JSON.stringify(e.details, null, 2)}` : "";
        const stackStr = e.stack ? `\nStack: ${e.stack}` : "";
        return `[${time}] [${e.level.toUpperCase()}] [${e.category}] ${e.message}${detailsStr}${stackStr}`;
      })
      .join("\n\n");
  }

  public exportAsJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}

export const clientLogger = new ClientLogger();

export const logError = (category: LogCategory, message: string, details?: unknown, stack?: string) =>
  clientLogger.log({ level: "error", category, message, details, stack, source: "client" });

export const logWarn = (category: LogCategory, message: string, details?: unknown) =>
  clientLogger.log({ level: "warn", category, message, details, source: "client" });

export const logInfo = (category: LogCategory, message: string, details?: unknown) =>
  clientLogger.log({ level: "info", category, message, details, source: "client" });

export const logDebug = (category: LogCategory, message: string, details?: unknown) =>
  clientLogger.log({ level: "debug", category, message, details, source: "client" });

export const getLogs = () => clientLogger.getEntries();
export const clearLogs = () => clientLogger.clear();
export const subscribeLogs = (fn: (entry: LogEntry) => void) => clientLogger.subscribe(fn);
export const exportLogsAsText = () => clientLogger.exportAsText();
export const exportLogsAsJson = () => clientLogger.exportAsJson();
