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

  it("reuses original textless blob zero-copy when needs_resize is false", async () => {
    const rawCleanBlob = new Blob(["exact-same-clean-bytes"], { type: "image/png" });
    const pages = [
      { url: "blob:p1", name: "01.png" },
      { url: "blob:p2", name: "01_clean.png" },
    ];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (url === "blob:p2") {
        return {
          ok: true,
          blob: async () => rawCleanBlob,
        } as unknown as Response;
      }
      return {
        ok: true,
        blob: async () => new Blob(["p1"], { type: "image/png" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const pairDetector = vi.fn(async () => ({
      is_match: true,
      text_role: "a_has_text" as const,
      needs_resize: false,
      background_variant: "bubbleless" as const,
      similarity: 0.98,
      aspect_diff_ratio: 0,
      text_blocks_a: 2,
      text_blocks_b: 0,
      detected_boxes: [{ x: 10, y: 20, width: 100, height: 150 }],
      scaled_textless_base64: null,
    }));

    const res = await detectAndPairTextlessPages(pages, { fetcher, pairDetector });
    expect(res.matchedPairs.length).toBe(1);
    expect(res.matchedPairs[0].scaledCleanBlob).toBe(rawCleanBlob);
    expect(res.matchedPairs[0].backgroundVariant).toBe("bubbleless");
    expect(res.matchedPairs[0].detectedBoxes).toEqual([{ x: 10, y: 20, width: 100, height: 150 }]);
  });

  it("calculates hamming distance and parses filename clean keywords correctly", async () => {
    const { hammingDistance64, parseFilenameHint } = await import("../../lib/cleaning/textlessMatcher");
    expect(hammingDistance64(BigInt(0), BigInt(1))).toBe(1);
    expect(hammingDistance64(BigInt("0b1010"), BigInt("0b0101"))).toBe(4);

    const hint1 = parseFilenameHint("ch01_p05_textless.jpg");
    expect(hint1.hasCleanKeyword).toBe(true);
    expect(hint1.normalizedStem).toBe("ch01p05");

    const hint2 = parseFilenameHint("002_clean.png");
    expect(hint2.hasCleanKeyword).toBe(true);
    expect(hint2.normalizedStem).toBe("002");

    const hint3 = parseFilenameHint("page_03.png");
    expect(hint3.hasCleanKeyword).toBe(false);
    expect(hint3.normalizedStem).toBe("page03");
  });

  it("finds candidate pairs by dHash similarity and filename hints", async () => {
    const { findCandidatePairs } = await import("../../lib/cleaning/textlessMatcher");
    const fingerprints = [
      { index: 0, hash: BigInt("0x12345678"), aspect: 0.66, normalizedStem: "p01", hasCleanKeyword: false },
      { index: 1, hash: BigInt("0x12345678"), aspect: 0.66, normalizedStem: "p01", hasCleanKeyword: true },
      { index: 2, hash: BigInt("0xabcdef00"), aspect: 0.66, normalizedStem: "p02", hasCleanKeyword: false },
      { index: 3, hash: BigInt("0xabcdef01"), aspect: 0.66, normalizedStem: "p02", hasCleanKeyword: true },
    ];
    const pairs = findCandidatePairs(fingerprints);
    expect(pairs).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});
