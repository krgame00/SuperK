import { NextResponse } from "next/server";
import {
  writeServerLog,
  readRecentServerLogs,
  clearServerLogs,
} from "@/lib/logger/serverLogger";
import type { LogEntry } from "@/lib/logger/types";

export async function GET() {
  try {
    const entries = readRecentServerLogs(300);

    let ocrHealthy = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      const res = await fetch("http://127.0.0.1:8765/health", {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        ocrHealthy = body?.status === "ok";
      }
    } catch {
      ocrHealthy = false;
    }

    return NextResponse.json({
      entries,
      serverTime: new Date().toISOString(),
      ocrHealthy,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to read logs", details: message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    const items: Array<Partial<LogEntry>> = Array.isArray(body.entries)
      ? body.entries
      : body.entry
      ? [body.entry]
      : body.level && body.message
      ? [body]
      : [];

    if (items.length === 0) {
      return NextResponse.json({ error: "No entries provided" }, { status: 400 });
    }

    for (const item of items) {
      if (item.level && item.category && item.message) {
        writeServerLog({
          level: item.level,
          category: item.category,
          message: item.message,
          details: item.details,
          source: item.source ?? "client",
          stack: item.stack,
        });
      }
    }

    return NextResponse.json({ success: true, count: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to append logs", details: message },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    clearServerLogs();
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to clear logs", details: message },
      { status: 500 }
    );
  }
}
