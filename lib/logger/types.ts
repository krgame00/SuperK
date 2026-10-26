export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogCategory = "translate" | "clean" | "export" | "network" | "system" | "ui";
export type LogSource = "client" | "server" | "ocr";

export interface LogEntry {
  id: string;
  timestamp: number;
  isoTime: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: unknown;
  source: LogSource;
  stack?: string;
}
