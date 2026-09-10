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
  sourceFingerprint?: string;
  maskFingerprint?: string;
  pipelineVersion?: string;
  revision?: number;
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
  pages: { url: string; name: string; originUrl?: string }[];
  currentPage: number;
  bubbleCache: [string, TranslatedBubble[]][];
  translatedAssetIds?: [string, string][];
  translatedImageCache?: [string, string][];
  updatedAt: number;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",");
  const mime = header?.match(/data:([^;]+)/)?.[1] || "image/png";
  // atob first — it exists in every browser and jsdom, and jsdom's Blob
  // implementation stringifies Buffer parts into "[object Object]".
  if (typeof atob === "function") {
    try {
      const binary = atob(payload || "");
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch {
      // payload wasn't valid base64 or had padding issues
    }
  }
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    const buffer = Buffer.from(payload || "", "base64");
    return new Blob([buffer], { type: mime });
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

export const saveProjectSession = async (
  data: {
    pages: { url: string; name: string; originUrl?: string }[];
    currentPage: number;
    bubbleCache: Map<string, TranslatedBubble[]>;
    translatedImageCache: Map<string, string>;
  },
  options?: { dirtyPageUrls?: Set<string> },
): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, ASSET_STORE_NAME], "readwrite");
    const sessionStore = tx.objectStore(STORE_NAME);
    const assetStore = tx.objectStore(ASSET_STORE_NAME);

    const dirty = options?.dirtyPageUrls;
    const translatedAssetIds: [string, string][] = [];
    const referencedAssetIds = new Set<string>();

    // Every page that still has bubbles is live even when its rendered image
    // was evicted from the in-memory LRU — its persisted asset must survive
    // and stay linked so a reload restores the whole book.
    const referencedPageUrls = new Set<string>([
      ...data.translatedImageCache.keys(),
      ...data.bubbleCache.keys(),
    ]);

    // Only re-encode and rewrite the (multi-MB) blobs of pages that actually
    // changed since the previous save. Omitting `dirtyPageUrls` performs a
    // full save.
    for (const pageUrl of referencedPageUrls) {
      const assetId = `translated_${encodeURIComponent(pageUrl)}`;
      translatedAssetIds.push([pageUrl, assetId]);
      referencedAssetIds.add(assetId);

      const imageValue = data.translatedImageCache.get(pageUrl);
      if (!imageValue || !imageValue.startsWith("data:")) continue;
      if (dirty && !dirty.has(pageUrl)) continue;
      const blob = dataUrlToBlob(imageValue);
      assetStore.put({
        id: assetId,
        mimeType: blob.type || "image/png",
        blob,
        createdAt: Date.now(),
      });
    }

    // Strip runtime-only fields (functions cannot be structured-cloned)
    // per bubble instead of JSON-roundtripping the whole record — the old
    // JSON.parse(JSON.stringify(...)) cloned every original page data URL
    // on every autosave.
    const bubbleCache: [string, TranslatedBubble[]][] = Array.from(
      data.bubbleCache.entries(),
      ([pageUrl, bubbles]) => [
        pageUrl,
        bubbles.map((bubble) => {
          const rest = { ...bubble };
          delete rest.render; // runtime-only function; not structured-cloneable
          return rest as TranslatedBubble;
        }),
      ],
    );

    const sessionData: SessionData = {
      id: "latest_session",
      pages: data.pages,
      currentPage: data.currentPage,
      bubbleCache,
      translatedAssetIds,
      updatedAt: Date.now(),
    };

    sessionStore.put(sessionData);

    // Garbage-collect translated assets that no longer belong to any page
    // (invalidated, replaced or removed pages).
    const keys = await requestResult<IDBValidKey[]>(assetStore.getAllKeys());
    for (const key of keys) {
      const assetId = String(key);
      if (!assetId.startsWith("translated_")) continue;
      if (referencedAssetIds.has(assetId)) continue;
      assetStore.delete(assetId);
    }

    await transactionDone(tx);
  } catch (err) {
    console.warn("Failed to save project session to IndexedDB", err);
    throw err;
  }
};

export const purgeOrphanAssets = async (): Promise<number> => {
  try {
    const db = await openDB();
    const readTx = db.transaction([STORE_NAME, ASSET_STORE_NAME], "readonly");
    const data = await requestResult<SessionData | undefined>(
      readTx.objectStore(STORE_NAME).get("latest_session"),
    );
    const keys = await requestResult<IDBValidKey[]>(
      readTx.objectStore(ASSET_STORE_NAME).getAllKeys(),
    );
    await transactionDone(readTx);

    const referenced = new Set(
      (data?.translatedAssetIds ?? []).map(([, assetId]) => assetId),
    );
    const orphans = keys
      .map(String)
      .filter((id) => id.startsWith("translated_") && !referenced.has(id));
    if (orphans.length === 0) return 0;

    const writeTx = db.transaction(ASSET_STORE_NAME, "readwrite");
    const store = writeTx.objectStore(ASSET_STORE_NAME);
    for (const assetId of orphans) {
      store.delete(assetId);
    }
    await transactionDone(writeTx);
    return orphans.length;
  } catch (err) {
    console.warn("Failed to purge orphan assets from IndexedDB", err);
    return 0;
  }
};

export const loadProjectSession = async (): Promise<{
  pages: { url: string; name: string; originUrl?: string }[];
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

    const rawAssets: Array<{ pageUrl: string; asset?: StoredAsset }> = [];

    // 1. Fetch all asset records within active IDB transaction
    if (data.translatedAssetIds && data.translatedAssetIds.length > 0) {
      for (const [pageUrl, assetId] of data.translatedAssetIds) {
        const asset = await requestResult<StoredAsset | undefined>(
          assetStore.get(assetId),
        );
        rawAssets.push({ pageUrl, asset });
      }
    }

    // 2. Convert blobs to Data URLs outside the IDB transaction
    for (const { pageUrl, asset } of rawAssets) {
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

    // 3. Fallback to legacy Data URLs (V2 schema backwards compatibility)
    if (data.translatedImageCache && data.translatedImageCache.length > 0) {
      for (const [pageUrl, dataUrl] of data.translatedImageCache) {
        if (!translatedImageCache.has(pageUrl)) {
          translatedImageCache.set(pageUrl, dataUrl);
        }
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
    const store = tx.objectStore(CLEANING_STORE_NAME);
    const existing = await requestResult<StoredCleaningResult | undefined>(
      store.get(result.pageUrl),
    );
    const existingRevision = existing?.revision ?? 0;
    const incomingRevision = result.revision ?? 0;
    if (
      existing &&
      (existingRevision > incomingRevision ||
        (existingRevision === incomingRevision && existing.updatedAt > result.updatedAt))
    ) {
      await transactionDone(tx);
      return;
    }
    store.put(result);
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

export interface AppendPagePayload {
  pageUrl: string;
  name?: string;
  cleanUrl?: string;
  bubbles?: TranslatedBubble[];
  originUrl?: string;
}

export const appendPageToProjectSession = async (
  payload: AppendPagePayload,
): Promise<{ pageIndex: number; totalPages: number }> => {
  const db = await openDB();
  const tx = db.transaction([STORE_NAME, ASSET_STORE_NAME], "readwrite");
  const sessionStore = tx.objectStore(STORE_NAME);
  const assetStore = tx.objectStore(ASSET_STORE_NAME);

  const rawSession = await requestResult<SessionData | undefined>(
    sessionStore.get("latest_session"),
  );

  let pages: { url: string; name: string; originUrl?: string }[] = [];
  let bubbleCacheMap = new Map<string, TranslatedBubble[]>();
  let translatedAssetIds: [string, string][] = [];

  if (rawSession && Array.isArray(rawSession.pages)) {
    pages = [...rawSession.pages];
    if (Array.isArray(rawSession.bubbleCache)) {
      bubbleCacheMap = new Map(rawSession.bubbleCache);
    }
    if (Array.isArray(rawSession.translatedAssetIds)) {
      translatedAssetIds = [...rawSession.translatedAssetIds];
    }
  }

  let pageIndex = pages.findIndex((p) => p.url === payload.pageUrl);
  if (pageIndex === -1) {
    pageIndex = pages.length;
    pages.push({
      url: payload.pageUrl,
      name: payload.name || `Page ${pages.length + 1}`,
      originUrl: payload.originUrl,
    });
  } else if (payload.originUrl) {
    pages[pageIndex].originUrl = payload.originUrl;
  }

  if (Array.isArray(payload.bubbles)) {
    const cleanBubbles = payload.bubbles.map((b) => {
      const copy = { ...b };
      delete copy.render;
      return copy as TranslatedBubble;
    });
    bubbleCacheMap.set(payload.pageUrl, cleanBubbles);
  }

  let cleanDataUrl = payload.cleanUrl;
  if (
    cleanDataUrl &&
    !cleanDataUrl.startsWith("data:") &&
    !cleanDataUrl.startsWith("blob:") &&
    !cleanDataUrl.startsWith("http")
  ) {
    cleanDataUrl = `data:image/png;base64,${cleanDataUrl}`;
  }

  if (cleanDataUrl && cleanDataUrl.startsWith("data:")) {
    const assetId = `translated_${encodeURIComponent(payload.pageUrl)}`;
    const blob = dataUrlToBlob(cleanDataUrl);
    assetStore.put({
      id: assetId,
      mimeType: blob.type || "image/png",
      blob,
      createdAt: Date.now(),
    });
    const existingAssetIdx = translatedAssetIds.findIndex(
      ([url]) => url === payload.pageUrl,
    );
    if (existingAssetIdx >= 0) {
      translatedAssetIds[existingAssetIdx] = [payload.pageUrl, assetId];
    } else {
      translatedAssetIds.push([payload.pageUrl, assetId]);
    }
  }

  const updatedSession: SessionData = {
    id: "latest_session",
    pages,
    currentPage: pageIndex,
    bubbleCache: Array.from(bubbleCacheMap.entries()),
    translatedAssetIds,
    updatedAt: Date.now(),
  };

  sessionStore.put(updatedSession);
  await transactionDone(tx);

  return {
    pageIndex,
    totalPages: pages.length,
  };
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
