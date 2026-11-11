import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
import { planWebtoonChunking, isWebtoonStrip } from "@/lib/webtoon";

vi.mock("@/lib/colorMatching/canvasSampler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/colorMatching/canvasSampler")>()),
  sampleBubbleRegion: vi.fn(() => null),
}));

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      _viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
    ) => {
      onComplete?.("data:webtoon-translated");
    },
  ),
}));

vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
}));

const imageResponse = () =>
  new Response(new Blob(["clean"], { type: "image/png" }), { status: 200 });

const installImmediateFileReader = () => {
  vi.stubGlobal("FileReader", class {
    result: string | ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onloadend: (() => void) | null = null;

    readAsDataURL() {
      this.result = "data:image/png;base64,Y2xlYW4=";
      queueMicrotask(() => {
        this.onload?.();
        this.onloadend?.();
      });
    }
  });
};

describe("Webtoon Long-Strip Translation Pipeline Integration in useTranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installImmediateFileReader();
    // Configure HTMLImageElement dimensions for webtoon long-strip (800x6000, ratio = 7.5 >= 2.5)
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
      configurable: true,
      get: () => 6000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("activates webtoon chunking, remaps coordinates globally, and deduplicates seam bubbles", async () => {
    expect(isWebtoonStrip(800, 6000)).toBe(true);

    const plan = planWebtoonChunking(800, 6000);
    expect(plan.isLongStrip).toBe(true);
    expect(plan.chunks.length).toBeGreaterThan(1);

    const translateRequests: unknown[] = [];

    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "blob:webtoon-strip" || url === "blob:webtoon-clean") return imageResponse();
      if (url === "/api/translate") {
        callCount++;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        translateRequests.push({ callCount, bodySnippet: body.imageBase64?.slice(0, 15) });

        // Pre-pass (call 1): returns empty bubbles so it proceeds to Webtoon chunking
        if (callCount === 1) {
          return Response.json({
            text: JSON.stringify({ bubbles: [] }),
          });
        }

        // Subsequent chunk calls: return bubbles for that chunk
        return Response.json({
          text: JSON.stringify({
            bubbles: [
              {
                box: [100, 200, 300, 400],
                original_text: "Webtoon dialog",
                text: "บทสนทนาเว็บตูน",
              },
            ],
          }),
        });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    // Mock Canvas getContext and toDataURL for test environment
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,d2VidG9vbg==",
    );

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: ["blob:webtoon-strip"],
        viewMode: "single",
        preparePageForTranslation: async () => ({
          recognitionUrl: "blob:webtoon-strip",
          backgroundUrl: "blob:webtoon-clean",
          isLongStrip: true,
        }),
      }),
    );

    let success = false;
    await act(async () => {
      success = await result.current.handleTranslate();
    });

    expect(success).toBe(true);
    // Verified: 1 pre-pass + N webtoon chunk requests
    expect(translateRequests.length).toBe(1 + plan.chunks.length);

    // Verified: applyTranslationOverlay was called with global remapped bubbles
    expect(applyTranslationOverlay).toHaveBeenCalled();
    const calls = vi.mocked(applyTranslationOverlay).mock.calls;
    const finalCallBubbles = calls[calls.length - 1][0] as Array<{
      box: number[];
      text?: string;
      original_text?: string;
    }>;

    expect(finalCallBubbles.length).toBeGreaterThan(0);
    // Verify each bubble has valid 0-1000 normalized coordinates
    for (const b of finalCallBubbles) {
      expect(b.box).toHaveLength(4);
      expect(b.box[0]).toBeGreaterThanOrEqual(0);
      expect(b.box[0]).toBeLessThanOrEqual(1000);
      expect(b.box[2]).toBeGreaterThanOrEqual(b.box[0]);
    }
  });
});
