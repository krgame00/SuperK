import { describe, expect, test, vi } from "vitest";
import { normalizePageExportSource, resolvePageExportUrl, exportImageBlob, exportImageFilename } from "@/lib/export/pageSource";
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
    expect(getUnconfirmedPages([{ url: "original", name: "blank", exportSource: "original" },
      { url: "clean", name: "clean", exportSource: "clean" }], new Set(), new Map(), bubbles)).toEqual([]);
  });
});
