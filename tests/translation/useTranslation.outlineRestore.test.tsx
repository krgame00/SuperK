import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useTranslation } from "@/hooks/useTranslation";
import { loadProjectSession, saveProjectSession } from "@/lib/projectStore";
import { sampleBubbleRegion } from "@/lib/colorMatching/canvasSampler";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import type { TextStyleProfile } from "@/lib/colorMatching/types";
import { createPageTargetIdentity } from "@/lib/translation/pageEligibility";

vi.mock("@/lib/translationOverlay", () => ({ applyTranslationOverlay: vi.fn() }));
vi.mock("@/lib/projectStore", () => ({ deleteAsset: vi.fn(), saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn(), clearProjectSession: vi.fn() }));
vi.mock("@/lib/colorMatching/canvasSampler", async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/colorMatching/canvasSampler')>(), sampleBubbleRegion: vi.fn() }));
vi.mock("@/lib/colorMatching/sampleTextColors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/colorMatching/sampleTextColors")>(), extractTextColors: vi.fn(),
}));

const original = "data:image/png;base64,c291cmNl";
const rendered = "data:image/png;base64,cmVuZGVyZWQ=";
const profile: TextStyleProfile = { source: "auto", evidenceState: "admitted", fillConfidence: .95,
  fill: "#159f9d", outline: "#ffffff", hasOutline: true, outlineWidthRatio: .13 };
function savedSession(unrecoverableSource = false, styleProfile = profile) {
  return { pages: [{ id: "page1", url: original, name: "page1", unrecoverableSource }],
    currentPage: 0, updatedAt: 0, hasUnrecoverableSources: unrecoverableSource,
    bubbleCache: new Map([[original, [{ box: [1, 2, 900, 900], t: "text", styleProfile }]]]),
    pageTargetCache: new Map([[original,createPageTargetIdentity("en")!]]),
    translatedImageCache: new Map([[original, rendered]]) };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  vi.mocked(sampleBubbleRegion).mockReturnValue({ width: 20, height: 20, rgba: new Uint8ClampedArray(1600) });
  vi.mocked(extractTextColors).mockReturnValue({ ...profile, fill: "#169e9d", hasOutline: false,
    outlineWidth: 0, outlineWidthRatio: 0, sourceOutlineVersion: "source-outline-v1" });
});
afterEach(() => { vi.useRealTimers(); });
function setup() {
  const onPageDirtied = vi.fn();
  const preparePageForTranslation = vi.fn();
  const hook = renderHook(() => useTranslation({ currentPage: 0, pages: [original], viewMode: "single",
    preparePageForTranslation, onPageDirtied }));
  return { ...hook, onPageDirtied, preparePageForTranslation };
}
test("saved restore samples original before caches install and persists the refreshed page as dirty", async () => {
  vi.mocked(loadProjectSession).mockResolvedValue(savedSession());
  const { result, onPageDirtied, preparePageForTranslation } = setup();
  await act(async () => { await result.current.restoreSavedSession(); });
  expect(sampleBubbleRegion).toHaveBeenCalledTimes(1);
  expect(vi.mocked(sampleBubbleRegion).mock.calls[0]).toHaveLength(2);
  expect(vi.mocked(sampleBubbleRegion).mock.calls[0][0]).toHaveProperty("src", original);
  expect(preparePageForTranslation).not.toHaveBeenCalled();
  expect(result.current.bubbleCacheRef.current.get(original)?.[0].styleProfile).toMatchObject({
    fill: profile.fill, hasOutline: false, sourceOutlineVersion: "source-outline-v1" });
  expect(result.current.translatedImageCacheRef.current.has(original)).toBe(false);
  expect(onPageDirtied).toHaveBeenCalledWith(original);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(vi.mocked(saveProjectSession).mock.calls.at(-1)?.[1]?.dirtyPageUrls?.has(original)).toBe(true);
});
test.each(["missing", "failed", "rejected", "mismatched-fill", "current", "manual", "readable"])("%s source refresh retains the cached image", async (kind) => {
  const style = { ...profile, ...(kind === "current" ? { sourceOutlineVersion: "source-outline-v1" } : {}),
    ...(kind === "manual" || kind === "readable" ? { ownershipMode: kind } : {}) } as TextStyleProfile;
  vi.mocked(loadProjectSession).mockResolvedValue(savedSession(kind === "missing", style));
  if (kind === "failed") vi.mocked(sampleBubbleRegion).mockReturnValue(null);
  if (kind === "rejected") vi.mocked(extractTextColors).mockReturnValue({ ...profile, evidenceState: "rejected" });
  if (kind === "mismatched-fill") vi.mocked(extractTextColors).mockReturnValue({ ...profile, fill: "#cc0000",
    hasOutline: false, outlineWidthRatio: 0, sourceOutlineVersion: "source-outline-v1" });
  const { result, onPageDirtied } = setup();
  await act(async () => { await result.current.restoreSavedSession(); });
  expect(result.current.translatedImageCacheRef.current.get(original)).toBe(rendered);
  expect(result.current.bubbleCacheRef.current.get(original)?.[0].styleProfile).toEqual(style);
  expect(onPageDirtied).not.toHaveBeenCalled();
  if (["missing", "current", "manual", "readable"].includes(kind)) expect(sampleBubbleRegion).not.toHaveBeenCalled();
});
