import { describe, expect, test, vi } from "vitest";
import {
  convertExportBlobToFormat,
  exportFormatToMime,
  exportImageBlob,
  exportImageFilename,
  normalizeExportImageFormat,
  normalizePageExportSource,
  resolvePageExportUrl,
} from "@/lib/export/pageSource";
import { getUnconfirmedPages } from "@/lib/export/reviewGate";

describe("per-page export sources", () => {
  test("legacy and invalid sources stay translated", () => {
    expect(normalizePageExportSource(undefined)).toBe("translated");
    expect(normalizePageExportSource("invalid")).toBe("translated");
  });
  test("mixed pages resolve original and clean before translated renderer", async () => {
    const render = vi.fn().mockResolvedValue("data:image/jpeg;base64,dA==");
    const urls = await Promise.all([
      resolvePageExportUrl({ url: "blob:original", exportSource: "original" }, undefined, render),
      resolvePageExportUrl({ url: "blob:original", exportSource: "clean" }, "blob:clean", render),
      resolvePageExportUrl({ url: "blob:original" }, "blob:clean", render),
    ]);
    expect(urls).toEqual(["blob:original", "blob:clean", "data:image/jpeg;base64,dA=="]);
    expect(render).toHaveBeenCalledTimes(1);
  });
  test("missing clean fails instead of falling back", async () => {
    await expect(resolvePageExportUrl({ url: "original", exportSource: "clean" }, undefined, vi.fn())).rejects.toThrow(/คลีน/);
  });
  test("blob image preserves bytes and filename follows MIME", async () => {
    const blob = new Blob(["source bytes"], { type: "image/webp" });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    expect(await exportImageBlob("blob:fixture", fetcher)).toBe(blob);
    expect(exportImageFilename("wrong.png", 0, blob.type)).toBe("SuperK_Page_001_wrong.webp");
  });
  test("original bypasses all review and clean bypasses translation review", () => {
    const bubbles = new Map([["original", [{ needsReview: true }]], ["clean", [{ needsReview: true }]]]);
    const cleanReview = {
      status: "inspected" as const,
      revisionKey: "reviewed-clean",
      revisions: { sourceRevision: "source", backgroundRevision: "background", removalRevision: "mask" },
      candidates: [],
      inspectedAreas: 1,
    };
    const result = getUnconfirmedPages([{ url: "original", name: "blank", exportSource: "original" },
      { url: "clean", name: "clean", exportSource: "clean" }], new Set(),
    new Map<string, never>([["clean", { cleanUrl: "clean" } as never]]), bubbles, undefined, undefined,
    { backgroundInspections: new Map([["clean", cleanReview]]) });
    expect(result).toEqual([]);
  });
  test("converts mixed page blobs to a single unified extension when requested", async () => {
    expect(normalizeExportImageFormat(undefined)).toBe("jpg");
    expect(exportFormatToMime("jpg")).toBe("image/jpeg");
    expect(exportFormatToMime("png")).toBe("image/png");
    expect(exportFormatToMime("webp")).toBe("image/webp");

    const webpBlob = new Blob(["webp-bytes"], { type: "image/webp" });
    const pngBlob = new Blob(["png-bytes"], { type: "image/png" });
    const convertedFromWebp = await convertExportBlobToFormat(webpBlob, "jpg", true);
    const convertedFromPng = await convertExportBlobToFormat(pngBlob, "jpg", true);

    expect(exportImageFilename("01.webp", 0, convertedFromWebp.type)).toBe("SuperK_Page_001_01.jpg");
    expect(exportImageFilename("02.png", 1, convertedFromPng.type)).toBe("SuperK_Page_002_02.jpg");
  });
});
