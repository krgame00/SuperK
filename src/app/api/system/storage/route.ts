import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireLocalRequest } from "@/lib/server/localRequest";
import { getLogFilePath } from "@/lib/logger/serverLogger";

interface OcrJobLargest {
  id: string;
  bytes: number;
  ageHours: number;
}

interface OcrModelEntry {
  name: string;
  path: string;
  bytes: number | null;
  present: boolean;
}

export interface StorageReport {
  serverTime: number;
  ocr: {
    reachable: boolean;
    error?: string;
    cacheDir: string;
    retentionHours: number;
    jobs: {
      count: number;
      bytes: number;
      oldestMs: number | null;
      newestMs: number | null;
      largest: OcrJobLargest[];
    };
    models: OcrModelEntry[];
    tempBytes: number | null;
    desktopIniHits: string[];
  };
  repo: {
    nextCache: {
      turbopackBytes: number | null;
      devCacheBytes: number | null;
      standaloneBytes: number | null;
    };
    logs: { path: string; bytes: number; rotatedBytes: number };
    savedProjects: { count: number; bytes: number };
    desktopIniHits: string[];
  };
}

const OCR_STORAGE_URL = "http://127.0.0.1:8765/v1/system/storage";
const DESKTOP_INI_MAX_DEPTH = 6;
const DESKTOP_INI_MAX_ENTRIES = 5000;

const numOr = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;
const numOrNull = (value: unknown): number | null =>
  typeof value === "number" ? value : null;
const strList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

/** Recursive file count + byte sum; null only when the root is unreadable. */
async function dirTotals(
  dir: string
): Promise<{ count: number; bytes: number } | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let count = 0;
  let bytes = 0;
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const sub = await dirTotals(child);
        if (sub) {
          count += sub.count;
          bytes += sub.bytes;
        }
      } else if (entry.isFile()) {
        count += 1;
        bytes += (await stat(child)).size;
      }
    } catch {
      // A vanished or unreadable entry contributes nothing.
    }
  }
  return { count, bytes };
}

async function dirSizeBytes(dir: string): Promise<number | null> {
  const totals = await dirTotals(dir);
  return totals === null ? null : totals.bytes;
}

async function fileSizeBytes(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

/** desktop.ini (Google Drive artifact) hunt under the Turbopack cache. */
async function findDesktopIniFiles(root: string): Promise<string[]> {
  const hits: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > DESKTOP_INI_MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.length > DESKTOP_INI_MAX_ENTRIES) return;
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.name.toLowerCase() === "desktop.ini") {
        hits.push(child);
      } else if (entry.isDirectory()) {
        await walk(child, depth + 1);
      }
    }
  };
  await walk(root, 0);
  return hits;
}

async function fetchOcrStorage(): Promise<StorageReport["ocr"]> {
  const unreachable: StorageReport["ocr"] = {
    reachable: false,
    error: "OCR service unreachable",
    cacheDir: "",
    retentionHours: 0,
    jobs: { count: 0, bytes: 0, oldestMs: null, newestMs: null, largest: [] },
    models: [],
    tempBytes: null,
    desktopIniHits: [],
  };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(OCR_STORAGE_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    if (!res.ok) return unreachable;
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return unreachable;

    const jobs = (body.jobs ?? {}) as Record<string, unknown>;
    const largest = Array.isArray(jobs.largest)
      ? jobs.largest.flatMap((item): OcrJobLargest[] => {
          const entry = item as Record<string, unknown>;
          return typeof entry.id === "string" && typeof entry.bytes === "number"
            ? [
                {
                  id: entry.id,
                  bytes: entry.bytes,
                  ageHours: numOr(entry.ageHours, 0),
                },
              ]
            : [];
        })
      : [];
    const models = Array.isArray(body.models)
      ? body.models.flatMap((item): OcrModelEntry[] => {
          const model = item as Record<string, unknown>;
          return typeof model.name === "string" && typeof model.path === "string"
            ? [
                {
                  name: model.name,
                  path: model.path,
                  bytes: numOrNull(model.bytes),
                  present: model.present === true,
                },
              ]
            : [];
        })
      : [];

    return {
      reachable: true,
      cacheDir: typeof body.cache_dir === "string" ? body.cache_dir : "",
      retentionHours: numOr(body.retention_hours, 0),
      jobs: {
        count: numOr(jobs.count, 0),
        bytes: numOr(jobs.bytes, 0),
        oldestMs: numOrNull(jobs.oldestMs),
        newestMs: numOrNull(jobs.newestMs),
        largest,
      },
      models,
      tempBytes: numOrNull(body.tempBytes),
      desktopIniHits: strList(body.desktopIniHits),
    };
  } catch {
    return unreachable;
  }
}

export async function GET(request: Request) {
  const denial = requireLocalRequest(request);
  if (denial) return denial;

  try {
    const cwd = process.cwd();
    const [ocr, turbopackBytes, devCacheBytes, standaloneBytes, savedProjects, desktopIniHits] =
      await Promise.all([
        fetchOcrStorage(),
        dirSizeBytes(path.join(cwd, ".next", "cache", "turbopack")),
        dirSizeBytes(path.join(cwd, ".next", "dev", "cache")),
        dirSizeBytes(path.join(cwd, ".next", "standalone")),
        dirTotals(path.join(cwd, "saved_projects")),
        findDesktopIniFiles(path.join(cwd, ".next", "dev", "cache", "turbopack")),
      ]);

    const logPath = getLogFilePath();
    const report: StorageReport = {
      serverTime: Date.now(),
      ocr,
      repo: {
        nextCache: { turbopackBytes, devCacheBytes, standaloneBytes },
        logs: {
          path: logPath,
          bytes: await fileSizeBytes(logPath),
          rotatedBytes: await fileSizeBytes(
            path.join(path.dirname(logPath), "server.log.1")
          ),
        },
        savedProjects: savedProjects ?? { count: 0, bytes: 0 },
        desktopIniHits,
      },
    };
    return NextResponse.json(report, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to collect storage report", details: message },
      { status: 500 }
    );
  }
}
