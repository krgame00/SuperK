import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTranslation } from "@/hooks/useTranslation";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { TranslatedBubble } from "@/lib/translationOverlay";

const installSuccessfulImageAndCanvas = () => {
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1000;
    naturalHeight = 1000;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    filter: "none",
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,c2xpY2U=",
  );
};

describe("WP-3.1: scanline ratios fast-path from cleaningResultsByPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installSuccessfulImageAndCanvas();
  });

  it("reuses pre-extracted scanline ratios from cleaning results without querying detectBubbleProfiles", async () => {
    const pageUrl = "blob:page-1";
    const pages = [pageUrl];

    const cleaningResult: PageCleaningResult = {
      jobId: "job-1",
      sourceHash: "hash-1",
      width: 1000,
      height: 1000,
      cleanAsset: "asset/clean.png",
      maskAsset: "asset/mask.png",
      reviewMaskAsset: "asset/review.png",
      protectedMaskAsset: "asset/protected.png",
      cleanUrl: "blob:clean-1",
      maskUrl: "blob:mask-1",
      reviewMaskUrl: "blob:review-1",
      protectedMaskUrl: "blob:protected-1",
      timingsMs: {},
      regions: [
        {
          id: "r1",
          rect: { x: 100, y: 100, width: 200, height: 200 },
          route: "flat",
          confidence: 0.95,
          status: "ready",
          residualScore: 0,
          damageScore: 0,
          pageRole: "comic",
          textRole: "dialogue",
          eligibilityConfidence: 0.9,
          automaticAction: "clean",
          protectionReasons: [],
          scanlineRatios: [0.5, 0.8, 1.0, 0.8, 0.5],
        },
      ],
    };

    const cleaningResultsByPage = new Map<string, PageCleaningResult>([
      [pageUrl, cleaningResult],
    ]);

    const preparePageForTranslation = vi.fn(async () => ({
      recognitionUrl: pageUrl,
      backgroundUrl: "blob:clean-1",
    }));

    const mockBubbles: TranslatedBubble[] = [
      {
        id: "b1",
        // Box in 0..1000 coordinates matching region: ymin=100, xmin=100, ymax=300, xmax=300
        box: [100, 100, 300, 300],
        original_text: "こんにちは",
        translation: "สวัสดี",
        detected_language: "ja",
      },
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === pageUrl) {
        return new Response(new Blob(["fake-img"], { type: "image/png" }), { status: 200 });
      }
      if (url === "/api/translate") {
        return Response.json({
          bubbles: mockBubbles,
          sourceDimensions: { width: 1000, height: 1000 },
        });
      }
      throw new Error(`unexpected fetch call: ${url}`);
    });

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages,
        viewMode: "single",
        preparePageForTranslation,
        cleaningResultsByPage,
      }),
    );

    await act(async () => {
      await result.current.handleTranslate();
    });

    // Check that bubbles in cache received pre-extracted scanline ratios
    const cachedBubbles = result.current.bubbleCacheRef.current.get(pageUrl);
    expect(cachedBubbles).toBeDefined();
    expect(cachedBubbles?.length).toBe(1);
    expect(cachedBubbles?.[0].scanlineRatios).toEqual([0.5, 0.8, 1.0, 0.8, 0.5]);
  });
});
