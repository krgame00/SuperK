"use client";

import type { ImageLayer } from "./commands";

const IMAGE_LAYERS_KEY = "superk:image-layers";

let memoryCache: Record<string, ImageLayer[]> | null = null;

function normalizePageKey(key: string): string {
  if (!key) return "page_0";
  try {
    const url = new URL(key);
    return url.pathname.split("/").pop() || key;
  } catch {
    return key;
  }
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
  if (typeof window === "undefined" || !window.localStorage) return;
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
  try {
    localStorage.setItem(IMAGE_LAYERS_KEY, JSON.stringify(all));
  } catch {
    // Quota exceeded or private browsing
  }
}

export function clearAllImageLayers(): void {
  memoryCache = null;
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.removeItem(IMAGE_LAYERS_KEY);
  } catch {}
}
