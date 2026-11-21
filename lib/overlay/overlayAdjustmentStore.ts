// Persistence for overlay adjustments in localStorage. The key and schema are
// frozen: user adjustments already live under this key in real browsers, so
// any shape change here silently loses their saved layouts. The bubble itself
// owns the authoritative layout state; this store is the fallback index.

import type { OverlayAdjustment, TranslatedBubble } from "./overlayTypes";
import { cloneTextStyleProfile } from "../colorMatching/resolveTextStyle";

export const bubbleKeyOf = (bubble: TranslatedBubble): string => {
  if (bubble.id !== undefined && bubble.id !== null) {
    return `id-${String(bubble.id)}`;
  }

  const boxKey = Array.isArray(bubble.box)
    && bubble.box.length === 4
    && bubble.box.every((value) => typeof value === "number" && Number.isFinite(value))
    ? bubble.box.map((value) => Number(value).toFixed(3)).join("-")
    : "";
  const sourceText = (bubble.original_text || "").trim().slice(0, 40);

  if (sourceText && boxKey) return `source-${sourceText}-${boxKey}`;
  if (boxKey) return `box-${boxKey}`;

  const fallbackText = (bubble.original_text || bubble.t || bubble.translated || "")
    .trim()
    .slice(0, 40);
  return `text-${fallbackText || "unknown"}`;
};

const ADJ_KEY = "superk:overlay-adjustments";

let cachedOverlayAdjRaw: string | null = null;
let cachedOverlayAdjMap: Record<string, Record<string, OverlayAdjustment>> | null = null;

export const readOverlayAdjustments = (): Record<string, Record<string, OverlayAdjustment>> => {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(ADJ_KEY) || "{}";
    if (raw === cachedOverlayAdjRaw && cachedOverlayAdjMap) {
      return cachedOverlayAdjMap;
    }
    const parsed = JSON.parse(raw);
    cachedOverlayAdjRaw = raw;
    cachedOverlayAdjMap = parsed;
    return parsed;
  } catch {
    return {};
  }
};

export const saveOverlayAdjustments = (adjustments: Record<string, Record<string, OverlayAdjustment>>): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const serialized = JSON.stringify(adjustments);
    cachedOverlayAdjRaw = serialized;
    cachedOverlayAdjMap = adjustments;
    localStorage.setItem(ADJ_KEY, serialized);
  } catch {}
};

export const compactOverlayPageKey = (pageKey: string): string => {
  if (!pageKey.startsWith("data:") && pageKey.length <= 512) return pageKey;

  // Imported pages are durable data URLs. Using the full base64 payload as a
  // localStorage object key can consume megabytes per page and silently hit
  // browser quota. Keep localStorage as a compact legacy/fallback index only;
  // the bubble itself owns the authoritative layout state.
  let hash = 0x811c9dc5;
  for (let i = 0; i < pageKey.length; i += 1) {
    hash ^= pageKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `page-${(hash >>> 0).toString(36)}-${pageKey.length}`;
};

export const readPageOverlayAdjustments = (pageKey: string): Record<string, OverlayAdjustment> => {
  const all = readOverlayAdjustments();
  return all[compactOverlayPageKey(pageKey)] ?? all[pageKey] ?? {};
};

export const syncPageOverlayAdjustments = (pageKey: string, bubbles: TranslatedBubble[]): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const storagePageKey = compactOverlayPageKey(pageKey);
    const all = { ...readOverlayAdjustments() };
    const nextPageAdj: Record<string, OverlayAdjustment> = {};
    for (const b of bubbles) {
      if (!b || b.deleted || !b.layoutAdjustment) continue;
      const bubbleId = bubbleKeyOf(b);
      nextPageAdj[bubbleId] = {
        ...b.layoutAdjustment,
        ...(b.styleProfile ? { styleProfile: cloneTextStyleProfile(b.styleProfile) } : {}),
      };
    }
    if (Object.keys(nextPageAdj).length > 0) {
      all[storagePageKey] = nextPageAdj;
    } else {
      delete all[storagePageKey];
    }
    if (storagePageKey !== pageKey && all[pageKey]) {
      delete all[pageKey];
    }
    saveOverlayAdjustments(all);
  } catch {}
};

export const clearPageAdjustments = (pageIndex: number): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const all = { ...readOverlayAdjustments() };
    const pageKey = `page-${pageIndex}`;
    if (all[pageKey]) {
      delete all[pageKey];
      saveOverlayAdjustments(all);
    }
  } catch {}
};

export const clearAllAdjustments = (): void => {
  cachedOverlayAdjRaw = null;
  cachedOverlayAdjMap = null;
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.removeItem(ADJ_KEY);
  } catch {}
};
