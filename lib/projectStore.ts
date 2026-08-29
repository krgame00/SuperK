// IndexedDB helper for Manga Translator project state and blob asset persistence

import type { CleaningRegion } from "./cleaning/types";
import type { TranslatedBubble } from "./translationOverlay";

const DB_NAME = "SuperKMangaTranslatorDB";
const DB_VERSION = 3;
const STORE_NAME = "project_session";
const CLEANING_STORE_NAME = "cleaning_results";
const ASSET_STORE_NAME = "assets";

export interface StoredCleaningResult {
  pageUrl: string;
  sourceHash: string;
  jobId: string;
  regions: CleaningRegion[];
  updatedAt: number;
}

export interface StoredAsset {
  id: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

interface SessionData {
  id: string;
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: [string, TranslatedBubble[]][];
  translatedAssetIds?: [string, string][];
  translatedImageCache?: [string, string][];
  updatedAt: number;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",");
  const mime = header?.match(/data:([^;]+)/)?.[1] || "image/png";
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    const buffer = Buffer.from(payload || "", "base64");
    return new Blob([buffer], { type: mime });
  }
  if (typeof atob === "function") {
    const binary = atob(payload || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([payload || ""], { type: mime });
}

export async function blobToDataUrl(
  blob: Blob | unknown,
  mimeType?: string,
): Promise<string> {
  const type = (blob as { type?: string })?.type || mimeType || "image/png";
  if (blob && typeof (blob as Blob).arrayBuffer === "function") {
    const buffer = await (blob as Blob).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 =
      typeof btoa === "function"
        ? btoa(binary)
        : Buffer.from(bytes).toString("base64");
    return `data:${type};base64,${base64}`;
  }
  if (blob && typeof (blob as { text?: () => Promise<string> }).text === "function") {
    const txt = await (blob as { text: () => Promise<string> }).text();
    const base64 = Buffer.from(txt).toString("base64");
    return `data:${type};base64,${base64}`;
  }
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob as Blob);
    } catch (err) {
      reject(err);
    }
  });
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
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
      }
    };
  });
};

export const saveAsset = async (
  id: string,
  blob: Blob,
  mimeType = "image/png",
): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
    const store = tx.objectStore(ASSET_STORE_NAME);
    const asset: StoredAsset = {
      id,
      mimeType: blob.type || mimeType,
      blob,
      createdAt: Date.now(),
    };
    store.put(asset);
    await transactionDone(tx);
  } catch (err) {
    console.warn("Failed to save asset to IndexedDB", err);
  }
};

export const loadAsset = async (id: string): Promise<Blob | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction(ASSET_STORE_NAME, "readonly");
    const store = tx.objectStore(ASSET_STORE_NAME);
    const asset = await requestResult<StoredAsset | undefined>(store.get(id));
    if (!asset?.blob) return null;
    const blobType = asset.blob.type || asset.mimeType || "image/png";
    return new Blob([asset.blob], { type: blobType });
  } catch (err) {
    console.warn("Failed to load asset from IndexedDB", err);
    return null;
  }
};

export const deleteAsset = async (id: string): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
    tx.objectStore(ASSET_STORE_NAME).delete(id);
    await transactionDone(tx);
  } catch (err) {
    console.warn("Failed to delete asset from IndexedDB", err);
  }
};

export const clearAssets = async (): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
    tx.objectStore(ASSET_STORE_NAME).clear();
    await transactionDone(tx);
  } catch (err) {
    console.warn("Failed to clear assets from IndexedDB", err);
  }
};

export const saveProjectSession = async (data: {
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: Map<string, TranslatedBubble[]>;
  translatedImageCache: Map<string, string>;
}): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, ASSET_STORE_NAME], "readwrite");
    const sessionStore = tx.objectStore(STORE_NAME);
    const assetStore = tx.objectStore(ASSET_STORE_NAME);

    const translatedAssetIds: [string, string][] = [];

    // Save image Blobs in the assets store instead of giant base64 strings
    for (const [pageUrl, imageValue] of data.translatedImageCache.entries()) {
      const assetId = `translated_${encodeURIComponent(pageUrl)}`;
      translatedAssetIds.push([pageUrl, assetId]);

      if (imageValue.startsWith("data:")) {
        const blob = dataUrlToBlob(imageValue);
        assetStore.put({
          id: assetId,
          mimeType: blob.type || "image/png",
          blob,
          createdAt: Date.now(),
        });
      }
    }

    const sessionData: SessionData = {
      id: "latest_session",
      pages: data.pages,
      currentPage: data.currentPage,
      bubbleCache: Array.from(data.bubbleCache.entries()),
      translatedAssetIds,
      updatedAt: Date.now(),
    };

    const sanitized = JSON.parse(JSON.stringify(sessionData));
    sessionStore.put(sanitized);

    await transactionDone(tx);
  } catch (err) {
    console.warn("Failed to save project session to IndexedDB", err);
  }
};

export const loadProjectSession = async (): Promise<{
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: Map<string, TranslatedBubble[]>;
  translatedImageCache: Map<string, string>;
  updatedAt: number;
} | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, ASSET_STORE_NAME], "readonly");
    const sessionStore = tx.objectStore(STORE_NAME);
    const assetStore = tx.objectStore(ASSET_STORE_NAME);

    const data = await requestResult<SessionData | undefined>(
      sessionStore.get("latest_session"),
    );

    if (!data || !data.pages || data.pages.length === 0) return null;

    const translatedImageCache = new Map<string, string>();

    // 1. Restore from Asset Blobs (V3 schema)
    if (data.translatedAssetIds && data.translatedAssetIds.length > 0) {
      for (const [pageUrl, assetId] of data.translatedAssetIds) {
        const asset = await requestResult<StoredAsset | undefined>(
          assetStore.get(assetId),
        );
        if (asset?.blob) {
          const blobObj =
            asset.blob instanceof Blob
              ? asset.blob
              : new Blob([asset.blob as BlobPart], {
                  type: asset.mimeType || "image/png",
                });
          const dataUrl = await blobToDataUrl(blobObj, asset.mimeType);
          translatedImageCache.set(pageUrl, dataUrl);
        }
      }
    } else if (
      data.translatedImageCache &&
      data.translatedImageCache.length > 0
    ) {
      // 2. Fallback to legacy Data URLs (V2 schema backwards compatibility)
      for (const [pageUrl, dataUrl] of data.translatedImageCache) {
        translatedImageCache.set(pageUrl, dataUrl);
      }
    }

    return {
      pages: data.pages,
      currentPage: data.currentPage || 0,
      bubbleCache: new Map(data.bubbleCache || []),
      translatedImageCache,
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
      [STORE_NAME, CLEANING_STORE_NAME, ASSET_STORE_NAME],
      "readwrite",
    );

    tx.objectStore(STORE_NAME).delete("latest_session");
    tx.objectStore(CLEANING_STORE_NAME).clear();
    tx.objectStore(ASSET_STORE_NAME).clear();
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
