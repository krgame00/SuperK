import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  analyzeRegionMaskLocally,
  applyGeminiMaskReviewToSuggestion,
  buildMaskDiffOverlay,
  extractImageRegionCrop,
  buildRegionComparisonStripBase64,
} from "@/lib/cleaning/aiMaskInspector";
import { POST as maskReviewPost } from "@/src/app/api/mask-review/route";

vi.mock("@/lib/server/geminiRequest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/geminiRequest")>();
  return {
    ...actual,
    requestGemini: vi.fn(),
  };
});

import { requestGemini } from "@/lib/server/geminiRequest";
const requestGeminiMock = vi.mocked(requestGemini);

function makeImageData(width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
}

describe("aiMaskInspector local algorithm", () => {
  test("buildMaskDiffOverlay calculates kept, added, removed pixels accurately", () => {
    const width = 20;
    const height = 20;
    const baseMask = makeImageData(width, height);
    const suggestedMask = makeImageData(width, height);

    // Set pixel (5, 5) active in baseMask only (removed)
    const idx5 = (5 * width + 5) * 4;
    baseMask.data[idx5 + 3] = 200;

    // Set pixel (6, 6) active in both (kept)
    const idx6 = (6 * width + 6) * 4;
    baseMask.data[idx6 + 3] = 200;
    suggestedMask.data[idx6 + 3] = 200;

    // Set pixel (7, 7) active in suggested only (added)
    const idx7 = (7 * width + 7) * 4;
    suggestedMask.data[idx7 + 3] = 200;

    const { diffMask, stats } = buildMaskDiffOverlay(
      baseMask,
      suggestedMask,
      { x: 0, y: 0, width: 20, height: 20 },
    );

    expect(stats.currentPixels).toBe(2);
    expect(stats.suggestedPixels).toBe(2);
    expect(stats.keptCount).toBe(1);
    expect(stats.addedCount).toBe(1);
    expect(stats.removedCount).toBe(1);
    expect(diffMask.width).toBe(20);
  });

  test("analyzeRegionMaskLocally returns audit result with verdict and diffMask", () => {
    const width = 30;
    const height = 30;
    const baseMask = makeImageData(width, height);

    // Fill a 10x10 interior square in baseMask
    for (let y = 10; y < 20; y++) {
      for (let x = 10; x < 20; x++) {
        const idx = (y * width + x) * 4;
        baseMask.data[idx] = 255;
        baseMask.data[idx + 1] = 55;
        baseMask.data[idx + 2] = 80;
        baseMask.data[idx + 3] = 150;
      }
    }

    const audit = analyzeRegionMaskLocally({
      regionId: "region-test",
      rect: { x: 5, y: 5, width: 20, height: 20 },
      baseMask,
    });

    expect(audit.regionId).toBe("region-test");
    expect(audit.source).toBe("local");
    expect(audit.stats).toBeDefined();
    expect(audit.suggestedMask.width).toBe(width);
  });

  test("applyGeminiMaskReviewToSuggestion applies addBoxes and protectBoxes", () => {
    const width = 40;
    const height = 40;
    const baseMask = makeImageData(width, height);
    const audit = analyzeRegionMaskLocally({
      regionId: "reg-1",
      rect: { x: 0, y: 0, width: 40, height: 40 },
      baseMask,
    });

    const hybrid = applyGeminiMaskReviewToSuggestion(audit, {
      verdict: "under_masked",
      summary: "พบตัวอักษรตกหล่นทางด้านล่าง",
      addBoxes: [[600, 100, 800, 300]],
      protectBoxes: [[0, 0, 100, 100]],
    });

    expect(hybrid.source).toBe("hybrid-gemini");
    expect(hybrid.verdict).toBe("under_masked");
    expect(hybrid.geminiSummary).toBe("พบตัวอักษรตกหล่นทางด้านล่าง");
    expect(hybrid.stats.suggestedPixels).toBeGreaterThan(0);
  });

  test("extractImageRegionCrop returns null for invalid input", () => {
    expect(extractImageRegionCrop(null, { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });

  test("buildRegionComparisonStripBase64 returns null if originalCrop is missing", () => {
    expect(
      buildRegionComparisonStripBase64({
        rect: { x: 0, y: 0, width: 10, height: 10 },
        originalCrop: null,
        cleanedCrop: null,
        maskData: makeImageData(10, 10),
      }),
    ).toBeNull();
  });
});

describe("POST /api/mask-review route", () => {
  beforeEach(() => {
    requestGeminiMock.mockReset();
    process.env.GEMINI_API_KEY = "test-api-key";
  });

  test("rejects requests missing imageBase64", async () => {
    const req = new Request("http://127.0.0.1:3000/api/mask-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await maskReviewPost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("INVALID_REQUEST");
  });

  test("calls requestGemini and returns structured verdict and boxes", async () => {
    requestGeminiMock.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    verdict: "under_masked",
                    summary: "พบเศษหมึกตกหล่นทางมุมขวา",
                    addBoxes: [[100, 200, 300, 400]],
                    protectBoxes: [],
                  }),
                },
              ],
            },
          },
        ],
      },
      keyIndex: 0,
      keyId: "k0",
      keySlot: 1,
      model: "gemini-3.5-flash-lite",
      meta: {
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        keyId: "k0",
        keySlot: 1,
        keyOwner: "server",
        attemptCount: 1,
        elapsedMs: 10,
        fallbackCount: 0,
        skippedRouteCount: 0,
      },
    });

    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const req = new Request("http://127.0.0.1:3000/api/mask-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: fakeBase64,
        regionId: "test-reg",
      }),
    });

    const res = await maskReviewPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verdict).toBe("under_masked");
    expect(data.summary).toBe("พบเศษหมึกตกหล่นทางมุมขวา");
    expect(data.addBoxes).toEqual([[100, 200, 300, 400]]);
  });
});
