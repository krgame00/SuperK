// IndexedDB helper for Manga Translator project state and blob asset persistence

import type { CleaningRegion } from "./cleaning/types";
import type { TranslatedBubble } from "./translationOverlay";
import { pageBlobStore } from "./lifecycle/pageBlobStore";

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
  cleanAssetId?: string;
  maskAssetId?: string;
  reviewMaskAssetId?: string;
  protectedMaskAssetId?: string;
  width?: number;
  height?: number;
  timingsMs?: Record<string, number | string>;
}

export interface StoredAsset {
  id: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

interface StoredSourceAsset {
  id: string;
  mimeType: string;
  bytes: Uint8Array;
  createdAt: number;
}

interface SessionData {
  id: string;
  pages: { id?: string; url: string; name: string; originUrl?: string; sourceAssetId?: string }[];
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

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function legacyPageId(url: string, index: number): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy-${index}-${(hash >>> 0).toString(36)}`;
}

import { blobToDataUrl } from "./imageDataUrl";
export { blobToDataUrl };

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
    const done = transactionDone(tx);
    const store = tx.objectStore(ASSET_STORE_NAME);
    const asset: StoredAsset = {
      id,
      mimeType: blob.type || mimeType,
      blob,
      createdAt: Date.now(),
    };
    store.put(asset);
    await done;
  } catch (err) {
    console.warn("Failed to save asset to IndexedDB", err);
  }
};

export const loadAsset = async (id: string): Promise<Blob | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction(ASSET_STORE_NAME, "readonly");
    const store = tx.objectStore(ASSET_STORE_NAME);
    const asset = await requestResult<StoredAsset | StoredSourceAsset | undefined>(store.get(id));
    if (asset && "bytes" in asset && asset.bytes) {
      return new Blob([Uint8Array.from(asset.bytes)], { type: asset.mimeType });
    }
    if (!asset || !("blob" in asset) || !asset.blob) return null;
    if (
      asset.blob instanceof Blob ||
      (typeof asset.blob === "object" &&
        typeof (asset.blob as Blob).arrayBuffer === "function")
    ) {
      return asset.blob as Blob;
    }
    const blobType =
      (asset.blob as { type?: string })?.type || asset.mimeType || "image/png";
    return new Blob([asset.blob as BlobPart], { type: blobType });
  } catch (err) {
    console.warn("Failed to load asset from IndexedDB", err);
    return null;
  }
};

export const deleteAsset = async (id: string): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
    const done = transactionDone(tx);
    tx.objectStore(ASSET_STORE_NAME).delete(id);
    await done;
  } catch (err) {
    console.warn("Failed to delete asset from IndexedDB", err);
  }
};

export const saveProjectSession = async (
  data: {
    pages: { id?: string; url: string; name: string; originUrl?: string }[];
    currentPage: number;
    bubbleCache: Map<string, TranslatedBubble[]>;
    translatedImageCache: Map<string, string>;
  },
  options?: { dirtyPageUrls?: Set<string> },
): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, ASSET_STORE_NAME], "readwrite");
    const txDone = transactionDone(tx);
    const sessionStore = tx.objectStore(STORE_NAME);
    const assetStore = tx.objectStore(ASSET_STORE_NAME);
    const previousSession = await requestResult<SessionData | undefined>(
      sessionStore.get("latest_session"),
    );

    const dirty = options?.dirtyPageUrls;
    const translatedAssetIds: [string, string][] = [];
    const referencedAssetIds = new Set<string>();
    const pageIdsByUrl = new Map<string, string>();
    const storedPages: SessionData["pages"] = [];

    for (const [index, page] of data.pages.entries()) {
      const id = page.id || legacyPageId(page.url, index);
      if (page.id || page.url.startsWith("data:")) {
        pageIdsByUrl.set(page.url, id);
      }
      if (page.url.startsWith("data:") ||
          (page.url.startsWith("blob:") && pageBlobStore.has(id))) {
        const sourceAssetId = `source_${id}`;
        const existingKey = await requestResult<IDBValidKey | undefined>(
          assetStore.getKey(sourceAssetId),
        );
        if (existingKey === undefined) {
          if (page.url.startsWith("data:")) {
            let sourceBytes: Uint8Array;
            try {
              sourceBytes = dataUrlToBytes(page.url);
            } catch {
              // Keep malformed legacy URLs readable instead of replacing them
              // with a source-asset reference that cannot be restored.
              storedPages.push({ ...page, id });
              continue;
            }
            const mimeType = page.url.match(/^data:([^;]+)/)?.[1] || "image/png";
            assetStore.put({
              id: sourceAssetId,
              mimeType,
              bytes: sourceBytes,
              createdAt: Date.now(),
            } satisfies StoredSourceAsset);
          } else {
            const blob = pageBlobStore.get(id);
            if (!blob) throw new Error(`Source image for page ${index + 1} is unavailable.`);
            assetStore.put({
              id: sourceAssetId,
              mimeType: blob.type || "image/png",
              blob,
              createdAt: Date.now(),
            } satisfies StoredAsset);
          }
        }
        referencedAssetIds.add(sourceAssetId);
        storedPages.push({
          id,
          url: `asset:${sourceAssetId}`,
          name: page.name,
          originUrl: page.originUrl,
          sourceAssetId,
        });
      } else {
        storedPages.push({ ...page, id });
      }
    }

    const previousAssetIds = new Map(previousSession?.translatedAssetIds ?? []);

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
      const pageId = pageIdsByUrl.get(pageUrl);
      const assetId = pageId
        ? `translated_${pageId}`
        : `translated_${encodeURIComponent(pageUrl)}`;
      const isDirty = dirty ? dirty.has(pageUrl) : true;
      const imageValue = data.translatedImageCache.get(pageUrl);
      const hasValidImage = typeof imageValue === "string" && imageValue.startsWith("data:");

      // If the page was explicitly dirtied (e.g. text changed) and has no rendered image in memory,
      // its previous persisted render is obsolete and must not be linked or preserved.
      if (dirty && isDirty && !hasValidImage) {
        continue;
      }

      if (hasValidImage) {
        translatedAssetIds.push([pageId ?? pageUrl, assetId]);
        referencedAssetIds.add(assetId);
        if (isDirty) {
          const mimeType = imageValue.match(/^data:([^;]+)/)?.[1] || "image/png";
          assetStore.put({
            id: assetId,
            mimeType,
            bytes: dataUrlToBytes(imageValue),
            createdAt: Date.now(),
          } satisfies StoredSourceAsset);
        }
      } else if (!dirty || !isDirty) {
        // Page was not dirtied, but image was evicted from in-memory cache (LRU eviction).
        // Keep the existing link to the valid persisted asset.
        const previousAssetId = previousAssetIds.get(pageId ?? "")
          ?? previousAssetIds.get(pageUrl)
          ?? assetId;
        translatedAssetIds.push([pageId ?? pageUrl, previousAssetId]);
        referencedAssetIds.add(previousAssetId);
      }
    }

    // Strip runtime-only fields (functions cannot be structured-cloned)
    // per bubble instead of JSON-roundtripping the whole record — the old
    // JSON.parse(JSON.stringify(...)) cloned every original page data URL
    // on every autosave.
    const bubbleCache: [string, TranslatedBubble[]][] = Array.from(
      data.bubbleCache.entries(),
      ([pageUrl, bubbles]) => [
        pageIdsByUrl.get(pageUrl) ?? pageUrl,
        bubbles.map((bubble) => {
          const rest = { ...bubble };
          delete rest.render; // runtime-only function; not structured-cloneable
          return rest as TranslatedBubble;
        }),
      ],
    );

    const sessionData: SessionData = {
      id: "latest_session",
      pages: storedPages,
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
      if (!assetId.startsWith("translated_") && !assetId.startsWith("source_")) continue;
      if (referencedAssetIds.has(assetId)) continue;
      assetStore.delete(assetId);
    }

    await txDone;
  } catch (err) {
    console.warn("Failed to save project session to IndexedDB", err);
    throw err;
  }
};

export const purgeOrphanAssets = async (): Promise<number> => {
  try {
    const db = await openDB();
    const readTx = db.transaction([STORE_NAME, ASSET_STORE_NAME], "readonly");
    const readDone = transactionDone(readTx);
    const data = await requestResult<SessionData | undefined>(
      readTx.objectStore(STORE_NAME).get("latest_session"),
    );
    const keys = await requestResult<IDBValidKey[]>(
      readTx.objectStore(ASSET_STORE_NAME).getAllKeys(),
    );
    await readDone;

    const referenced = new Set(
      (data?.translatedAssetIds ?? []).map(([, assetId]) => assetId),
    );
    const orphans = keys
      .map(String)
      .filter((id) => id.startsWith("translated_") && !referenced.has(id));
    if (orphans.length === 0) return 0;

    const writeTx = db.transaction(ASSET_STORE_NAME, "readwrite");
    const writeDone = transactionDone(writeTx);
    const store = writeTx.objectStore(ASSET_STORE_NAME);
    for (const assetId of orphans) {
      store.delete(assetId);
    }
    await writeDone;
    return orphans.length;
  } catch (err) {
    console.warn("Failed to purge orphan assets from IndexedDB", err);
    return 0;
  }
};

export interface ProjectSessionPage {
  id?: string;
  url: string;
  name: string;
  originUrl?: string;
  unrecoverableSource?: boolean;
}

export interface LoadedProjectSession {
  pages: ProjectSessionPage[];
  currentPage: number;
  bubbleCache: Map<string, TranslatedBubble[]>;
  translatedImageCache: Map<string, string>;
  updatedAt: number;
  hasUnrecoverableSources: boolean;
}

export const loadProjectSession = async (): Promise<LoadedProjectSession | null> => {
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
    const sourceAssets: Array<{
      page: SessionData["pages"][number];
      asset?: StoredSourceAsset | StoredAsset;
    }> = [];

    for (const page of data.pages) {
      if (!page.sourceAssetId) continue;
      const asset = await requestResult<StoredSourceAsset | StoredAsset | undefined>(
        assetStore.get(page.sourceAssetId),
      );
      sourceAssets.push({ page, asset });
    }

    const rawAssets: Array<{
      pageUrl: string;
      asset?: StoredAsset | StoredSourceAsset;
    }> = [];

    // Finish all IndexedDB reads before converting a Blob. FileReader yields
    // to the event loop, which can close an otherwise idle transaction.
    if (data.translatedAssetIds && data.translatedAssetIds.length > 0) {
      for (const [pageUrl, assetId] of data.translatedAssetIds) {
        const asset = await requestResult<StoredAsset | StoredSourceAsset | undefined>(
          assetStore.get(assetId),
        );
        rawAssets.push({ pageUrl, asset });
      }
    }

    const sourceById = new Map<string, Blob>();
    for (const { page, asset } of sourceAssets) {
      if (page.id && asset) {
        const blob = "bytes" in asset && asset.bytes
          ? new Blob([Uint8Array.from(asset.bytes)], { type: asset.mimeType })
          : "blob" in asset ? asset.blob : undefined;
        if (blob) sourceById.set(page.id, blob);
      }
    }

    const processedPages: ProjectSessionPage[] = [];
    const pageUrlById = new Map<string, string>();
    for (const [index, page] of data.pages.entries()) {
      const id = page.id ?? legacyPageId(page.url, index);
      const sourceBlob = sourceById.get(id);
      const url = sourceBlob ? await blobToDataUrl(sourceBlob, sourceBlob.type) : page.url;
      if (sourceBlob) pageBlobStore.set(id, sourceBlob, sourceBlob.type);
      const unrecoverableSource = page.sourceAssetId
        ? !sourceBlob
        : typeof url === "string" && url.startsWith("blob:");
      processedPages.push({
        id,
        url,
        name: page.name,
        originUrl: page.originUrl,
        unrecoverableSource,
      });
      pageUrlById.set(id, url);
    }

    // Convert blobs to Data URLs after all IndexedDB requests have completed.
    for (const { pageUrl, asset } of rawAssets) {
      if (asset && ("bytes" in asset || "blob" in asset)) {
        const blobObj =
          "bytes" in asset && asset.bytes
            ? new Blob([Uint8Array.from(asset.bytes)], { type: asset.mimeType })
            : "blob" in asset && asset.blob instanceof Blob
              ? asset.blob
              : new Blob([("blob" in asset ? asset.blob : undefined) as BlobPart], {
                  type: asset.mimeType || "image/png",
                });
        const dataUrl = await blobToDataUrl(blobObj, asset.mimeType);
        translatedImageCache.set(pageUrlById.get(pageUrl) ?? pageUrl, dataUrl);
      }
    }

    // 3. Fallback to legacy Data URLs (V2 schema backwards compatibility)
    if (data.translatedImageCache && data.translatedImageCache.length > 0) {
      for (const [pageUrl, dataUrl] of data.translatedImageCache) {
        if (!translatedImageCache.has(pageUrl)) {
          translatedImageCache.set(pageUrlById.get(pageUrl) ?? pageUrl, dataUrl);
        }
      }
    }

    const hasUnrecoverableSources = processedPages.some((p) => p.unrecoverableSource);

    return {
      pages: processedPages,
      currentPage: data.currentPage || 0,
      bubbleCache: new Map(
        (data.bubbleCache || []).map(([pageKey, bubbles]) => [
          pageUrlById.get(pageKey) ?? pageKey,
          bubbles,
        ]),
      ),
      translatedImageCache,
      updatedAt: data.updatedAt,
      hasUnrecoverableSources,
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
    const done = transactionDone(tx);

    tx.objectStore(STORE_NAME).delete("latest_session");
    tx.objectStore(CLEANING_STORE_NAME).clear();
    tx.objectStore(ASSET_STORE_NAME).clear();
    await done;
  } catch (err) {
    console.warn("Failed to clear project session from IndexedDB", err);
  }
};

export const saveCleaningResultMetadata = async (
  result: StoredCleaningResult,
): Promise<void> => {
  try {
    const db = await openDB();
    let shouldWrite = true;
    try {
      const readTx = db.transaction(CLEANING_STORE_NAME, "readonly");
      const readDone = transactionDone(readTx);
      const existing = await requestResult<StoredCleaningResult | undefined>(
        readTx.objectStore(CLEANING_STORE_NAME).get(result.pageUrl),
      );
      await readDone;

      const existingRevision = existing?.revision ?? 0;
      const incomingRevision = result.revision ?? 0;
      if (
        existing &&
        (existingRevision > incomingRevision ||
          (existingRevision === incomingRevision && existing.updatedAt > result.updatedAt))
      ) {
        shouldWrite = false;
      }
    } catch {
      // If reading fails, proceed to write
    }

    if (!shouldWrite) return;

    const writeTx = db.transaction(CLEANING_STORE_NAME, "readwrite");
    const writeDone = transactionDone(writeTx);
    writeTx.objectStore(CLEANING_STORE_NAME).put(result);
    await writeDone;
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

export const saveCleaningAssets = async (
  pageUrl: string,
  assets: {
    cleanBlob?: Blob;
    maskBlob?: Blob;
    reviewMaskBlob?: Blob;
    protectedMaskBlob?: Blob;
  },
  pageId?: string,
): Promise<{
  cleanAssetId?: string;
  maskAssetId?: string;
  reviewMaskAssetId?: string;
  protectedMaskAssetId?: string;
}> => {
  const result: {
    cleanAssetId?: string;
    maskAssetId?: string;
    reviewMaskAssetId?: string;
    protectedMaskAssetId?: string;
  } = {};

  try {
    const assetKey = pageId || encodeURIComponent(pageUrl);
    if (assets.cleanBlob && assets.cleanBlob.size > 0) {
      result.cleanAssetId = `clean_${assetKey}`;
      await saveAsset(result.cleanAssetId, assets.cleanBlob, assets.cleanBlob.type || "image/png");
    }
    if (assets.maskBlob && assets.maskBlob.size > 0) {
      result.maskAssetId = `mask_${assetKey}`;
      await saveAsset(result.maskAssetId, assets.maskBlob, assets.maskBlob.type || "image/png");
    }
    if (assets.reviewMaskBlob && assets.reviewMaskBlob.size > 0) {
      result.reviewMaskAssetId = `review_mask_${assetKey}`;
      await saveAsset(result.reviewMaskAssetId, assets.reviewMaskBlob, assets.reviewMaskBlob.type || "image/png");
    }
    if (assets.protectedMaskBlob && assets.protectedMaskBlob.size > 0) {
      result.protectedMaskAssetId = `protected_mask_${assetKey}`;
      await saveAsset(result.protectedMaskAssetId, assets.protectedMaskBlob, assets.protectedMaskBlob.type || "image/png");
    }
  } catch (err) {
    console.warn("Failed to save cleaning assets to IndexedDB", err);
  }

  return result;
};

export const loadCleaningResultAssets = async (
  metadata: StoredCleaningResult,
): Promise<{
  cleanBlob: Blob | null;
  maskBlob: Blob | null;
  reviewMaskBlob: Blob | null;
  protectedMaskBlob: Blob | null;
}> => {
  const cleanAssetId = metadata.cleanAssetId || `clean_${encodeURIComponent(metadata.pageUrl)}`;
  const maskAssetId = metadata.maskAssetId || `mask_${encodeURIComponent(metadata.pageUrl)}`;
  const reviewMaskAssetId = metadata.reviewMaskAssetId || `review_mask_${encodeURIComponent(metadata.pageUrl)}`;
  const protectedMaskAssetId = metadata.protectedMaskAssetId || `protected_mask_${encodeURIComponent(metadata.pageUrl)}`;

  const [cleanBlob, maskBlob, reviewMaskBlob, protectedMaskBlob] = await Promise.all([
    loadAsset(cleanAssetId),
    loadAsset(maskAssetId),
    loadAsset(reviewMaskAssetId),
    loadAsset(protectedMaskAssetId),
  ]);

  return { cleanBlob, maskBlob, reviewMaskBlob, protectedMaskBlob };
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
  const done = transactionDone(tx);
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
  await done;

  return {
    pageIndex,
    totalPages: pages.length,
  };
};

const transactionDone = (
  tx: IDBTransaction,
  timeoutMs: number = 4000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    }, timeoutMs);

    const onDone = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const onFail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(tx.error || new Error("IDBTransaction failed"));
    };

    if (typeof tx.addEventListener === "function") {
      tx.addEventListener("complete", onDone, { once: true });
      tx.addEventListener("error", onFail, { once: true });
      tx.addEventListener("abort", onFail, { once: true });
    } else {
      tx.oncomplete = onDone;
      tx.onerror = onFail;
      tx.onabort = onFail;
    }
  });

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
