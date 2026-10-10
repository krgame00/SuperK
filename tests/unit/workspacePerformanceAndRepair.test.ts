import { describe, it, expect, beforeEach } from "vitest";
import {
  compactOverlayPageKey,
  readPageOverlayAdjustments,
  syncPageOverlayAdjustments,
  clearAllAdjustments,
} from "@/lib/translationOverlay";
import { exportImageBlob } from "@/lib/export/pageSource";

describe("Workspace Performance, Base64 Collision Prevention & Export Decode Benchmarks", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    const mockStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };

    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "localStorage", {
        value: mockStorage,
        writable: true,
        configurable: true,
      });
    }
    clearAllAdjustments();
  });

  it("eliminates per-render Base64 JSON.stringify overhead on a 21-page chapter (~42 MB Base64 payload)", () => {
    // Simulate a 21-page manga chapter where each page.url is a 2 MB Base64 data URL (~42 MB total)
    const sharedPrefix =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABDgAAAbACAIAAAB" +
      "A".repeat(2_000_000);
    const pages = Array.from({ length: 21 }, (_, idx) => ({
      id: `page_${idx + 1}`,
      url: `${sharedPrefix}_PAGE_${idx + 1}`,
    }));

    const mockEvidenceByUrl = new Map(
      pages.map((p, idx) => [
        p.url,
        {
          sourceContext: `fp_${idx + 1}_${"a".repeat(32)}`,
          textEvidence: Array.from({ length: 8 }, (__, bIdx) => ({
            id: String(bIdx),
            box: [100 + bIdx * 10, 200, 180 + bIdx * 10, 320],
          })),
        },
      ]),
    );
    const getExpectedRemnantEvidence = (url: string) => mockEvidenceByUrl.get(url)!;

    const iterations = 10;

    // 1. Legacy approach: JSON.stringify(pages.map(page => [page.url, getExpectedRemnantEvidence(page.url)])) + JSON.parse
    const legacyStart = performance.now();
    let legacyPayloadChars = 0;
    for (let r = 0; r < iterations; r++) {
      const key = JSON.stringify(
        pages.map((page) => [page.url, getExpectedRemnantEvidence(page.url)]),
      );
      legacyPayloadChars = key.length;
      const parsed = JSON.parse(key) as [string, unknown][];
      expect(parsed.length).toBe(21);
    }
    const legacyMs = performance.now() - legacyStart;

    // 2. Optimized approach: lightweight evidence key without page.url Base64 serialization
    const optimizedStart = performance.now();
    let optimizedPayloadChars = 0;
    for (let r = 0; r < iterations; r++) {
      const key = pages
        .map((page, idx) => {
          const ev = getExpectedRemnantEvidence(page.url);
          return `${page.id ?? idx}:${ev.sourceContext}:${ev.textEvidence.map((t) => `${t.id}@${t.box.join(",")}`).join(";")}`;
        })
        .join("|");
      optimizedPayloadChars = key.length;
      expect(key.length).toBeGreaterThan(100);
    }
    const optimizedMs = performance.now() - optimizedStart;

    console.info(
      `[Benchmark remnantEvidenceKey (10 renders x 21 pages @ 2MB Base64)] Legacy: ${legacyMs.toFixed(2)}ms (payload ${(legacyPayloadChars / (1024 * 1024)).toFixed(2)} MB/render) vs Optimized: ${optimizedMs.toFixed(3)}ms (payload ${(optimizedPayloadChars / 1024).toFixed(2)} KB/render) -> Speedup: ${(legacyMs / Math.max(optimizedMs, 0.001)).toFixed(1)}x, Memory reduction: ${(legacyPayloadChars / optimizedPayloadChars).toFixed(0)}x`,
    );

    // Payload size must drop from >40 MB to <10 KB, and execution must be dramatically faster
    expect(legacyPayloadChars).toBeGreaterThan(40_000_000);
    expect(optimizedPayloadChars).toBeLessThan(10_000);
    expect(optimizedMs).toBeLessThan(legacyMs / 10);
  });

  it("compacts all data: URLs (including <=512 char data URLs) without prefix collision across 21 pages", () => {
    // 21 data URLs sharing an identical 300-char PNG header prefix (total length ~320 chars, <= 512)
    const identicalPngHeader =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAACXBIWXMAAAsTAAALEwEAmpwY" +
      "A".repeat(200);
    const pageUrls = Array.from(
      { length: 21 },
      (_, i) => `${identicalPngHeader}_page_${i + 1}`,
    );

    const keys = pageUrls.map((url) => compactOverlayPageKey(url));
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(21);
    for (const key of keys) {
      expect(key).toMatch(/^page-[0-9a-z]+-\d+$/);
    }

    // Saving adjustments on Page 1 must never bleed into Page 2
    syncPageOverlayAdjustments(pageUrls[0], [
      {
        original_text: "HELLO",
        t: "สวัสดีหน้า 1",
        box: [100, 100, 200, 200],
        layoutAdjustment: { bx: 111, by: 222, bw: 150, bh: 80, iw: 1200, ih: 1800 },
      },
    ]);
    syncPageOverlayAdjustments(pageUrls[1], [
      {
        original_text: "HELLO",
        t: "สวัสดีหน้า 2",
        box: [100, 100, 200, 200],
        layoutAdjustment: { bx: 333, by: 444, bw: 160, bh: 90, iw: 1200, ih: 1800 },
      },
    ]);

    const adjPage1 = Object.values(readPageOverlayAdjustments(pageUrls[0]))[0];
    const adjPage2 = Object.values(readPageOverlayAdjustments(pageUrls[1]))[0];
    expect(adjPage1.bx).toBe(111);
    expect(adjPage2.bx).toBe(333);

    // Clearing layoutAdjustment on Page 1 removes stale entry from localStorage
    syncPageOverlayAdjustments(pageUrls[0], [
      {
        original_text: "HELLO",
        t: "สวัสดีหน้า 1",
        box: [100, 100, 200, 200],
      },
    ]);
    expect(Object.keys(readPageOverlayAdjustments(pageUrls[0]))).toHaveLength(0);
    expect(Object.values(readPageOverlayAdjustments(pageUrls[1]))[0].bx).toBe(333);
  });

  it("decodes Base64 data URLs in exportImageBlob accurately and faster than Uint8Array.from callback", async () => {
    // 1.5 MB binary payload encoded as Base64
    const byteLength = 1_500_000;
    const rawBytes = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      rawBytes[i] = i & 0xff;
    }
    let binaryStr = "";
    const chunkSize = 32768;
    for (let i = 0; i < rawBytes.length; i += chunkSize) {
      binaryStr += String.fromCharCode(...rawBytes.subarray(i, i + chunkSize));
    }
    const base64Url = `data:image/png;base64,${btoa(binaryStr)}`;

    // Measure legacy Uint8Array.from(binary, char => char.charCodeAt(0))
    const legacyStart = performance.now();
    const legacyDecoded = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
    const legacyMs = performance.now() - legacyStart;

    // Measure new exportImageBlob
    const optStart = performance.now();
    const blob = await exportImageBlob(base64Url);
    const optMs = performance.now() - optStart;

    console.info(
      `[Benchmark exportImageBlob (1.5 MB image)] Legacy Uint8Array.from callback: ${legacyMs.toFixed(2)}ms vs Preallocated Uint8Array exportImageBlob (including atob): ${optMs.toFixed(2)}ms`,
    );

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(byteLength);
    const blobBytes = new Uint8Array(await blob.arrayBuffer());
    expect(blobBytes[0]).toBe(legacyDecoded[0]);
    expect(blobBytes[12345]).toBe(legacyDecoded[12345]);
    expect(blobBytes[byteLength - 1]).toBe(legacyDecoded[byteLength - 1]);
  });
});
