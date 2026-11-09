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

  test("detects unmasked text across multiple speech balloons in a single region (TDD)", () => {
    const width = 120;
    const height = 120;
    const baseMask = makeImageData(width, height); // Initially 0 masked pixels!
    const originalCrop = makeImageData(width, height);

    // Fill background with character art / tone (gray, luma ~ 100)
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      originalCrop.data[idx] = 100;
      originalCrop.data[idx + 1] = 100;
      originalCrop.data[idx + 2] = 100;
      originalCrop.data[idx + 3] = 255;
    }

    // Speech Balloon 1: [x: 10..45, y: 10..45] (white balloon, luma ~ 250)
    for (let y = 10; y <= 45; y++) {
      for (let x = 10; x <= 45; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 250;
        originalCrop.data[idx + 1] = 250;
        originalCrop.data[idx + 2] = 250;
      }
    }
    // Text inside Balloon 1: dark stroke (luma ~ 20)
    for (let y = 20; y <= 35; y++) {
      for (let x = 20; x <= 35; x++) {
        if (x >= 25 && x <= 28) {
          const idx = (y * width + x) * 4;
          originalCrop.data[idx] = 20;
          originalCrop.data[idx + 1] = 20;
          originalCrop.data[idx + 2] = 20;
        }
      }
    }

    // Speech Balloon 2: [x: 70..105, y: 15..55] (white balloon, luma ~ 250)
    for (let y = 15; y <= 55; y++) {
      for (let x = 70; x <= 105; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 250;
        originalCrop.data[idx + 1] = 250;
        originalCrop.data[idx + 2] = 250;
      }
    }
    // Text inside Balloon 2: dark stroke (luma ~ 20)
    for (let y = 25; y <= 45; y++) {
      for (let x = 80; x <= 95; x++) {
        if (y >= 30 && y <= 33) {
          const idx = (y * width + x) * 4;
          originalCrop.data[idx] = 20;
          originalCrop.data[idx + 1] = 20;
          originalCrop.data[idx + 2] = 20;
        }
      }
    }

    const audit = analyzeRegionMaskLocally({
      regionId: "multi-balloon-region-3",
      rect: { x: 0, y: 0, width, height },
      baseMask,
      originalCrop,
    });

    // Expect: The audit should detect the unmasked text in BOTH balloons!
    expect(audit.verdict).toBe("under_masked");
    expect(audit.stats.addedCount).toBeGreaterThan(30);

    // Check that text stroke in Balloon 1 is masked
    const b1Idx = (25 * width + 26) * 4;
    expect(audit.suggestedMask.data[b1Idx + 3]).toBeGreaterThan(0);

    // Check that text stroke in Balloon 2 is masked
    const b2Idx = (31 * width + 85) * 4;
    expect(audit.suggestedMask.data[b2Idx + 3]).toBeGreaterThan(0);

    // Check that character artwork outside balloons is NOT masked
    const artIdx = (80 * width + 20) * 4;
    expect(audit.suggestedMask.data[artIdx + 3]).toBe(0);
  });

  test("detects faint inpainting residue specks on cleaned balloons (TDD)", () => {
    const width = 80;
    const height = 80;
    const baseMask = makeImageData(width, height); // 0 mask
    const originalCrop = makeImageData(width, height);
    const cleanedCrop = makeImageData(width, height);

    // Fill white balloon [10..70, 10..70]
    for (let y = 10; y <= 70; y++) {
      for (let x = 10; x <= 70; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 250;
        originalCrop.data[idx + 1] = 250;
        originalCrop.data[idx + 2] = 250;
        originalCrop.data[idx + 3] = 255;

        // Cleaned image is mostly clean (250)
        cleanedCrop.data[idx] = 250;
        cleanedCrop.data[idx + 1] = 250;
        cleanedCrop.data[idx + 2] = 250;
        cleanedCrop.data[idx + 3] = 255;
      }
    }

    // Faint residue specks left on cleaned image (luma 225, difference 25) at [30..34, 30..34]
    for (let y = 30; y <= 34; y++) {
      for (let x = 30; x <= 34; x++) {
        const idx = (y * width + x) * 4;
        cleanedCrop.data[idx] = 225;
        cleanedCrop.data[idx + 1] = 225;
        cleanedCrop.data[idx + 2] = 225;
      }
    }

    const audit = analyzeRegionMaskLocally({
      regionId: "residue-region",
      rect: { x: 0, y: 0, width, height },
      baseMask,
      originalCrop,
      cleanedCrop,
    });

    expect(audit.verdict).toBe("under_masked");
    expect(audit.stats.addedCount).toBeGreaterThan(10);
    const speckIdx = (32 * width + 32) * 4;
    expect(audit.suggestedMask.data[speckIdx + 3]).toBeGreaterThan(0);
  });

  test("rejects shirt wrinkles, face sweat drops, and hair from false-positive masking on cleaned regions (TDD)", () => {
    const width = 100;
    const height = 100;
    const baseMask = makeImageData(width, height);
    const originalCrop = makeImageData(width, height);
    const cleanedCrop = makeImageData(width, height);

    // 1. Balloon with faint residue:
    // Balloon paper (250)
    for (let y = 10; y <= 40; y++) {
      for (let x = 10; x <= 40; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 250;
        originalCrop.data[idx + 1] = 250;
        originalCrop.data[idx + 2] = 250;
        originalCrop.data[idx + 3] = 255;
        cleanedCrop.data[idx] = 250;
        cleanedCrop.data[idx + 1] = 250;
        cleanedCrop.data[idx + 2] = 250;
        cleanedCrop.data[idx + 3] = 255;
      }
    }
    // Residue speck at (25, 25): original was ink 25, clean has faint grey 215
    for (let y = 24; y <= 26; y++) {
      for (let x = 24; x <= 26; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 25;
        originalCrop.data[idx + 1] = 25;
        originalCrop.data[idx + 2] = 25;
        cleanedCrop.data[idx] = 215;
        cleanedCrop.data[idx + 1] = 215;
        cleanedCrop.data[idx + 2] = 215;
      }
    }

    // 2. Character white shirt with wrinkle line:
    // White shirt background (240)
    for (let y = 50; y <= 90; y++) {
      for (let x = 50; x <= 90; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 240;
        originalCrop.data[idx + 1] = 240;
        originalCrop.data[idx + 2] = 240;
        originalCrop.data[idx + 3] = 255;
        cleanedCrop.data[idx] = 240;
        cleanedCrop.data[idx + 1] = 240;
        cleanedCrop.data[idx + 2] = 240;
        cleanedCrop.data[idx + 3] = 255;
      }
    }
    // Shirt wrinkle line: dark line (35) in BOTH original and cleaned (untouched by inpainting)
    for (let y = 60; y <= 80; y++) {
      for (let x = 68; x <= 70; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 35;
        originalCrop.data[idx + 1] = 35;
        originalCrop.data[idx + 2] = 35;
        cleanedCrop.data[idx] = 35;
        cleanedCrop.data[idx + 1] = 35;
        cleanedCrop.data[idx + 2] = 35;
      }
    }

    // 3. Face sweat drop: thin vertical line (20) on light skin (235) in BOTH original and cleaned
    for (let y = 60; y <= 72; y++) {
      const idx = (y * width + 25) * 4;
      originalCrop.data[idx] = 20;
      originalCrop.data[idx + 1] = 20;
      originalCrop.data[idx + 2] = 20;
      originalCrop.data[idx + 3] = 255;
      cleanedCrop.data[idx] = 20;
      cleanedCrop.data[idx + 1] = 20;
      cleanedCrop.data[idx + 2] = 20;
      cleanedCrop.data[idx + 3] = 255;
    }

    const audit = analyzeRegionMaskLocally({
      regionId: "shirt-sweat-test",
      rect: { x: 0, y: 0, width, height },
      baseMask,
      originalCrop,
      cleanedCrop,
    });

    // Residue speck in balloon SHOULD be detected
    const speckIdx = (25 * width + 25) * 4;
    expect(audit.suggestedMask.data[speckIdx + 3]).toBeGreaterThan(0);

    // Shirt wrinkle line MUST NOT be masked
    const shirtIdx = (70 * width + 69) * 4;
    expect(audit.suggestedMask.data[shirtIdx + 3]).toBe(0);

    // Sweat drop MUST NOT be masked
    const sweatIdx = (65 * width + 25) * 4;
    expect(audit.suggestedMask.data[sweatIdx + 3]).toBe(0);
  });

  test("rejects isolated strokes on white clothing and skin in unmasked images without cleanCrop (TDD)", () => {
    const width = 100;
    const height = 100;
    const baseMask = makeImageData(width, height);
    const originalCrop = makeImageData(width, height);

    // Dark background for character shading (80)
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      originalCrop.data[idx] = 80;
      originalCrop.data[idx + 1] = 80;
      originalCrop.data[idx + 2] = 80;
      originalCrop.data[idx + 3] = 255;
    }

    // 1. White Speech Balloon [10..45, 10..45] with text cluster:
    for (let y = 10; y <= 45; y++) {
      for (let x = 10; x <= 45; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 250;
        originalCrop.data[idx + 1] = 250;
        originalCrop.data[idx + 2] = 250;
      }
    }
    // Letter 1 ("I"): x=20..22, y=20..32
    for (let y = 20; y <= 32; y++) {
      for (let x = 20; x <= 22; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 25;
        originalCrop.data[idx + 1] = 25;
        originalCrop.data[idx + 2] = 25;
      }
    }
    // Letter 2 ("T"): horizontal bar at y=20..22, x=27..35; stem at x=30..32, y=23..32
    for (let x = 27; x <= 35; x++) {
      for (let y = 20; y <= 22; y++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 25;
        originalCrop.data[idx + 1] = 25;
        originalCrop.data[idx + 2] = 25;
      }
    }
    for (let y = 23; y <= 32; y++) {
      for (let x = 30; x <= 32; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 25;
        originalCrop.data[idx + 1] = 25;
        originalCrop.data[idx + 2] = 25;
      }
    }

    // 2. White shirt [55..95, 55..95] with single isolated wrinkle:
    for (let y = 55; y <= 95; y++) {
      for (let x = 55; x <= 95; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 240;
        originalCrop.data[idx + 1] = 240;
        originalCrop.data[idx + 2] = 240;
      }
    }
    // Isolated wrinkle stroke at x=75, y=65..80
    for (let y = 65; y <= 80; y++) {
      const idx = (y * width + 75) * 4;
      originalCrop.data[idx] = 30;
      originalCrop.data[idx + 1] = 30;
      originalCrop.data[idx + 2] = 30;
    }

    // 3. Isolated sweat drop at x=85, y=20..30 on light skin [70..95, 10..40]:
    for (let y = 10; y <= 40; y++) {
      for (let x = 70; x <= 95; x++) {
        const idx = (y * width + x) * 4;
        originalCrop.data[idx] = 235;
        originalCrop.data[idx + 1] = 235;
        originalCrop.data[idx + 2] = 235;
      }
    }
    for (let y = 20; y <= 30; y++) {
      const idx = (y * width + 85) * 4;
      originalCrop.data[idx] = 30;
      originalCrop.data[idx + 1] = 30;
      originalCrop.data[idx + 2] = 30;
    }

    const audit = analyzeRegionMaskLocally({
      regionId: "unmasked-cluster-test",
      rect: { x: 0, y: 0, width, height },
      baseMask,
      originalCrop,
      // cleanedCrop is undefined
    });

    // The text in the balloon SHOULD be masked
    const textIdx = (25 * width + 21) * 4;
    expect(audit.suggestedMask.data[textIdx + 3]).toBeGreaterThan(0);

    // The isolated shirt wrinkle MUST NOT be masked
    const shirtIdx = (72 * width + 75) * 4;
    expect(audit.suggestedMask.data[shirtIdx + 3]).toBe(0);

    // The isolated sweat drop MUST NOT be masked
    const sweatIdx = (25 * width + 85) * 4;
    expect(audit.suggestedMask.data[sweatIdx + 3]).toBe(0);
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

  test("extractMaskRegionCrop and spliceMaskRegionCrop preserve dimensions and roundtrip mask edits", async () => {
    const { extractMaskRegionCrop, spliceMaskRegionCrop } = await import("@/lib/cleaning/aiMaskInspector");
    const fullMask = makeImageData(100, 80);
    // Fill full mask with active pixel at (25, 25)
    const idx25 = (25 * 100 + 25) * 4;
    fullMask.data[idx25] = 255;
    fullMask.data[idx25 + 3] = 200;

    const crop = extractMaskRegionCrop(fullMask, { x: 20, y: 20, width: 20, height: 15 });
    expect(crop).not.toBeNull();
    expect(crop!.width).toBe(20);
    expect(crop!.height).toBe(15);
    expect(crop!.data.length).toBe(20 * 15 * 4);

    // The pixel at global (25, 25) is at local (5, 5)
    const localIdx = (5 * 20 + 5) * 4;
    expect(crop!.data[localIdx]).toBe(255);
    expect(crop!.data[localIdx + 3]).toBe(200);

    // Modify local crop: add a pixel at local (0, 0)
    crop!.data[0] = 100;
    crop!.data[3] = 150;

    const spliced = spliceMaskRegionCrop(fullMask, crop!, { x: 20, y: 20, width: 20, height: 15 });
    expect(spliced.width).toBe(100);
    expect(spliced.height).toBe(80);
    expect(spliced.data.length).toBe(100 * 80 * 4);

    // The spliced mask should now have pixel at global (20, 20)
    const globalIdx20 = (20 * 100 + 20) * 4;
    expect(spliced.data[globalIdx20]).toBe(100);
    expect(spliced.data[globalIdx20 + 3]).toBe(150);
  });
});
