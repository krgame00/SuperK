import "fake-indexeddb/auto";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

import { clearProjectSession, loadProjectSession, saveProjectSession } from "@/lib/projectStore";

const corpusFolder = process.env.SUPERK_BENCH_FOLDER;

test.skipIf(!corpusFolder)("persists the supplied CBZ corpus without image-sized session metadata", async () => {
  const names = (await readdir(corpusFolder!))
    .filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const pages = [];
  for (const [index, name] of names.entries()) {
    const bytes = await readFile(path.join(corpusFolder!, name));
    const mimeType = /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
    pages.push({
      id: `corpus-page-${index}`,
      name,
      url: `data:${mimeType};base64,${bytes.toString("base64")}`,
    });
  }

  const sourceChars = pages.reduce((sum, page) => sum + page.url.length, 0);
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const bubbleCache = new Map<string, { t: string }[]>();
  await saveProjectSession({
    pages,
    currentPage: 0,
    bubbleCache,
    translatedImageCache: new Map(),
  });
  const saveMs = Math.round(performance.now() - started);
  let peakHeap = process.memoryUsage().heapUsed;
  const batchStarted = performance.now();
  for (const [index, page] of pages.entries()) {
    bubbleCache.set(page.url, [{ t: `translated page ${index + 1}` }]);
    await saveProjectSession({
      pages,
      currentPage: index,
      bubbleCache,
      translatedImageCache: new Map(),
    }, { dirtyPageUrls: new Set([page.url]) });
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }
  const batchSaveMs = Math.round(performance.now() - batchStarted);

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("SuperKMangaTranslatorDB", 3);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction("project_session", "readonly");
  const record = await new Promise<{ pages: { url: string }[] }>((resolve, reject) => {
    const request = tx.objectStore("project_session").get("latest_session");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();

  const metadataChars = JSON.stringify(record).length;
  const restored = await loadProjectSession();
  const after = process.memoryUsage().heapUsed;
  console.info(JSON.stringify({
    pages: pages.length,
    sourceMB: Math.round(sourceChars / 1_000_000),
    sessionMetadataKB: Math.round(metadataChars / 1000),
    saveMs,
    batchSaveMs,
    peakHeapMB: Math.round(peakHeap / 1_000_000),
    heapDeltaMB: Math.round((after - before) / 1_000_000),
  }));

  expect(restored?.pages.length).toBe(pages.length);
  expect(restored?.pages.map((page) => page.url)).toEqual(pages.map((page) => page.url));
  expect(restored?.bubbleCache.size).toBe(pages.length);
  expect(metadataChars).toBeLessThan(sourceChars / 100);
  expect(peakHeap - before).toBeLessThan(1_000_000_000);
  await clearProjectSession();
}, 120_000);
