// IndexedDB helper for Manga Translator project state persistence

import type { CleaningRegion } from "./cleaning/types";

const DB_NAME = "SuperKMangaTranslatorDB";
const DB_VERSION = 2;
const STORE_NAME = "project_session";
const CLEANING_STORE_NAME = "cleaning_results";

export interface StoredCleaningResult {
  pageUrl: string;
  sourceHash: string;
  jobId: string;
  regions: CleaningRegion[];
  updatedAt: number;
}

interface SessionData {
  id: string;
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: [string, unknown[]][];
  translatedImageCache: [string, string][];
  updatedAt: number;
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CLEANING_STORE_NAME)) {
        db.createObjectStore(CLEANING_STORE_NAME, { keyPath: "pageUrl" });
      }
    };
  });
};

export const saveProjectSession = async (data: {
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: Map<string, unknown[]>;
  translatedImageCache: Map<string, string>;
}): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const sessionData: SessionData = {
      id: "latest_session",
      pages: data.pages,
      currentPage: data.currentPage,
      bubbleCache: Array.from(data.bubbleCache.entries()),
      translatedImageCache: Array.from(data.translatedImageCache.entries()),
      updatedAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const req = store.put(sessionData);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to save project session to IndexedDB", err);
  }
};

export const loadProjectSession = async (): Promise<{
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: Map<string, unknown[]>;
  translatedImageCache: Map<string, string>;
  updatedAt: number;
} | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    const data = await new Promise<SessionData | null>((resolve, reject) => {
      const req = store.get("latest_session");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!data || !data.pages || data.pages.length === 0) return null;

    return {
      pages: data.pages,
      currentPage: data.currentPage || 0,
      bubbleCache: new Map(data.bubbleCache || []),
      translatedImageCache: new Map(data.translatedImageCache || []),
      updatedAt: data.updatedAt,
    };
  } catch (err) {
    console.warn("Failed to load project session from IndexedDB", err);
    return null;
  }
};

export const clearProjectSession = async (): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(
      [STORE_NAME, CLEANING_STORE_NAME],
      "readwrite",
    );

    tx.objectStore(STORE_NAME).delete("latest_session");
    tx.objectStore(CLEANING_STORE_NAME).clear();
    await transactionDone(tx);
  } catch (err) {
    console.warn("Failed to clear project session from IndexedDB", err);
  }
};

export const saveCleaningResultMetadata = async (
  result: StoredCleaningResult,
): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(CLEANING_STORE_NAME, "readwrite");
    tx.objectStore(CLEANING_STORE_NAME).put(result);
    await transactionDone(tx);
  } catch (err) {
    console.warn("Failed to save cleaning result metadata", err);
  }
};

export const loadCleaningResultsMetadata = async (): Promise<
  Map<string, StoredCleaningResult>
> => {
  try {
    const db = await openDB();
    const tx = db.transaction(CLEANING_STORE_NAME, "readonly");
    const request = tx
      .objectStore(CLEANING_STORE_NAME)
      .getAll() as IDBRequest<StoredCleaningResult[]>;
    const results = await requestResult(request);
    return new Map(results.map((result) => [result.pageUrl, result]));
  } catch (err) {
    console.warn("Failed to load cleaning result metadata", err);
    return new Map();
  }
};

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
