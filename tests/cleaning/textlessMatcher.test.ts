import { describe, expect, it, vi } from "vitest";
import { detectAndPairTextlessPages } from "../../lib/cleaning/textlessMatcher";

describe("detectAndPairTextlessPages", () => {
  const makeFetcher = (blobs: Record<string, Blob>) =>
    vi.fn(async (url: RequestInfo | URL) => {
      const key = String(url);
      if (key.startsWith("data:")) {
        return new Response(new Blob(["scaled-png"], { type: "image/png" }), { status: 200 });
      }
      const b = blobs[key];
      return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

  it("pairs sequential with-text and textless pages and detaches textless page", async () => {
    const pages = [
      { url: "blob:p1", name: "01.png" },
      { url: "blob:p2", name: "02.png" },
      { url: "blob:p3", name: "03.png" },
    ];
    const fetcher = makeFetcher({
      "blob:p1": new Blob(["p1"], { type: "image/png" }),
      "blob:p2": new Blob(["p2"], { type: "image/png" }),
      "blob:p3": new Blob(["p3"], { type: "image/png" }),
    });
    const pairDetector = vi.fn(async () => ({
      is_match: true,
      text_role: "a_has_text" as const,
      similarity: 0.94,
      aspect_diff_ratio: 0,
      text_blocks_a: 3,
      text_blocks_b: 0,
      scaled_textless_base64: "data:image/png;base64,AAAA",
    }));

    const res = await detectAndPairTextlessPages(pages, { fetcher, pairDetector });
    expect(res.matchedPairs.length).toBe(1);
    expect(res.matchedPairs[0].textPage.name).toBe("01.png");
    expect(res.matchedPairs[0].textlessPage.name).toBe("02.png");
    expect(res.filteredPages.map((p) => p.name)).toEqual(["01.png", "03.png"]);
    expect(res.detachedByTextPageUrl.get("blob:p1")?.name).toBe("02.png");
  });

  it("fails open and keeps all pages when detector throws", async () => {
    const pages = [
      { url: "blob:p1", name: "01.png" },
      { url: "blob:p2", name: "02.png" },
    ];
    const fetcher = makeFetcher({
      "blob:p1": new Blob(["p1"], { type: "image/png" }),
      "blob:p2": new Blob(["p2"], { type: "image/png" }),
    });
    const pairDetector = vi.fn(async () => {
      throw new Error("OCR service offline");
    });

    const res = await detectAndPairTextlessPages(pages, { fetcher, pairDetector });
    expect(res.matchedPairs).toEqual([]);
    expect(res.filteredPages.map((p) => p.name)).toEqual(["01.png", "02.png"]);
  });

  it("rethrows AbortError so a cancelled scan stops instead of failing open", async () => {
    const pages = [
      { url: "blob:p1", name: "01.png" },
      { url: "blob:p2", name: "02.png" },
    ];
    const fetcher = makeFetcher({
      "blob:p1": new Blob(["p1"], { type: "image/png" }),
      "blob:p2": new Blob(["p2"], { type: "image/png" }),
    });
    const pairDetector = vi.fn(async () => {
      throw new DOMException("Scanning stopped", "AbortError");
    });

    await expect(
      detectAndPairTextlessPages(pages, { fetcher, pairDetector }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
