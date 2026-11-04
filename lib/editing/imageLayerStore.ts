"use client";

import type { ImageLayer } from "./commands";

const IMAGE_LAYERS_KEY = "superk:image-layers";
const DB_NAME = "SuperKImageLayersDB";
const DB_VERSION = 1;
const STORE_NAME = "image_layers";

let memoryCache: Record<string, ImageLayer[]> | null = null;
let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

export function normalizePageKey(key: string): string {
  if (!key) return "page_0";
  if (key.startsWith("data:")) return key;
  try {
    const url = new URL(key);
    return url.pathname.split("/").pop() || key;
  } catch {
    return key;
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function flushImageLayersToIndexedDB(): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    const db = await openDB();
    const data = readAllImageLayers();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ id: "all", layers: data });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Graceful fallback if IndexedDB is blocked or quota exceeded
  }
}

export async function loadImageLayersFromIndexedDB(): Promise<Record<string, ImageLayer[]>> {
  if (typeof window === "undefined" || !window.indexedDB) return readAllImageLayers();
  try {
    const db = await openDB();
    const result = await new Promise<{ id: string; layers: Record<string, ImageLayer[]> } | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get("all");
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      },
    );
    if (result?.layers) {
      memoryCache = { ...readAllImageLayers(), ...result.layers };
      return memoryCache;
    }
  } catch {
    // Fall back to memoryCache or localStorage
  }
  return readAllImageLayers();
}

export function readAllImageLayers(): Record<string, ImageLayer[]> {
  if (memoryCache) return memoryCache;
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(IMAGE_LAYERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    memoryCache = parsed;
    return parsed;
  } catch {
    return {};
  }
}

export function readPageImageLayers(pageKey: string): ImageLayer[] {
  const all = readAllImageLayers();
  const normalized = normalizePageKey(pageKey);
  return all[normalized] ?? all[pageKey] ?? [];
}

export function savePageImageLayers(pageKey: string, layers: ImageLayer[]): void {
  const normalized = normalizePageKey(pageKey);
  const all = { ...readAllImageLayers() };
  if (layers.length > 0) {
    all[normalized] = layers;
    if (normalized !== pageKey) delete all[pageKey];
  } else {
    delete all[normalized];
    delete all[pageKey];
  }
  memoryCache = all;

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(IMAGE_LAYERS_KEY, JSON.stringify(all));
    } catch {
      // Quota exceeded: data remains safe in memoryCache and will flush to IndexedDB below
    }
  }

  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    flushImageLayersToIndexedDB().catch(() => {});
  }, 150);
}

export function clearAllImageLayers(): void {
  memoryCache = null;
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
    debounceTimeout = null;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem(IMAGE_LAYERS_KEY);
    } catch {}
  }
  if (typeof window !== "undefined" && window.indexedDB) {
    openDB()
      .then((db) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete("all");
      })
      .catch(() => {});
  }
}
