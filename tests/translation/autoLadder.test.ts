import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslation } from "@/hooks/useTranslation";
import { DIAGNOSTIC_TAXONOMY } from "@/lib/translation/diagnostics";

vi.mock("@/lib/colorMatching/canvasSampler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/colorMatching/canvasSampler")>()),
  sampleBubbleRegion: vi.fn(() => null),
}));

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (firstArg: unknown, ...restArgs: unknown[]) => {
      const normalizedCall = Array.isArray(firstArg)
        ? {
            _bubbles: firstArg,
            viewMode: restArgs[0],
            _pageIndex: restArgs[2],
            _setTranslationResult: restArgs[3],
            onComplete: restArgs[4],
            containerOverride: restArgs[6],
          }
        : (firstArg as Record<string, unknown>);
      const { onComplete, containerOverride } = normalizedCall as {
        onComplete?: (dataUrl: string) => void;
        containerOverride?: HTMLElement;
      };

      const preparedSrc = containerOverride
        ?.querySelector("img")
        ?.getAttribute("src");
      onComplete?.(
        containerOverride
          ? `data:offscreen,${preparedSrc}`
          : "data:interactive",
      );
    },
  ),
}));

vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
}));

describe("Phase 4: Auto-Ladder on SAFETY_BLOCKED", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1600);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(100) })),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,c2xpY2U=");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("automatically escalates whole-page SAFETY_BLOCKED to Adaptive Slicing without manual bypass mode", async () => {
    const fetchCalls: { url: string; body?: any }[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      fetchCalls.push({ url, body });

      if (url === "blob:original" || url === "blob:clean") {
        return new Response(new Blob(["mock-image"], { type: "image/png" }), { status: 200 });
      }

      if (url === "/api/translate") {
        // First call is whole-page: returns SAFETY_BLOCKED
        if (fetchCalls.filter((c) => c.url === "/api/translate").length === 1) {
          return Response.json(
            { error: "SAFETY_BLOCKED", message: "Prompt blocked by Gemini Safety: OTHER" },
            { status: 400 },
          );
        }

        // Subsequent calls are adaptive slices: succeed!
        return Response.json({
          text: JSON.stringify({
            bubbles: [
              {
                box: [100, 100, 200, 200],
                t: "สวัสดีข้อความแปล",
              },
            ],
          }),
        });
      }

      if (url === "/api/translation-review") {
        return Response.json({ reviews: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: ["blob:original"],
        viewMode: "single",
        preparePageForTranslation: async () => ({
          recognitionUrl: "blob:original",
          backgroundUrl: "blob:clean",
        }),
      }),
    );

    // Initial state: nsfwBypassMode is false
    expect(result.current.nsfwBypassMode).toBe(false);

    let success = false;
    await act(async () => {
      success = await result.current.handleTranslate();
    });

    // Translation must succeed via automatic laddering
    expect(success).toBe(true);

    // Verify calls: exactly 1 whole-page (blocked) + 2 level-1 adaptive slices (saved 1 redundant pre-pass call)
    const translateCalls = fetchCalls.filter((c) => c.url === "/api/translate");
    expect(translateCalls.length).toBe(3);

    // Cached bubbles must contain the recovered slice bubble
    const cached = result.current.bubbleCacheRef.current.get("blob:original");
    expect(cached).toBeDefined();
    expect(cached!.length).toBeGreaterThanOrEqual(1);

    // nsfwBypassMode state must remain false (not permanently mutated across session)
    expect(result.current.nsfwBypassMode).toBe(false);
  });

  it("transparently auto-ladders blocked pages during batch translateAll without failing the job", async () => {
    const fetchCalls: { url: string; body?: any }[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      fetchCalls.push({ url, body });

      if (url.startsWith("blob:")) {
        return new Response(new Blob(["mock-image"], { type: "image/png" }), { status: 200 });
      }

      if (url === "/api/translate") {
        const imageBase64 = body?.imageBase64;
        // Page 2 whole-page: simulate safety block
        if (imageBase64 === "cGFnZTItb3JpZ2luYWw=") {
          return Response.json(
            { error: "SAFETY_BLOCKED", message: "Prompt blocked by Gemini Safety: OTHER" },
            { status: 400 },
          );
        }

        // All other requests (Page 1 whole-page, Page 2 adaptive slices): succeed
        return Response.json({
          text: JSON.stringify({
            bubbles: [
              {
                box: [50, 50, 150, 150],
                t: "ข้อความแปลสำเร็จ",
              },
            ],
          }),
        });
      }

      if (url === "/api/translation-review") {
        return Response.json({ reviews: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: ["blob:page1", "blob:page2"],
        viewMode: "single",
        preparePageForTranslation: async (_url, idx) => ({
          recognitionUrl: idx === 0 ? "blob:page1" : "blob:page2",
          backgroundUrl: idx === 0 ? "blob:page1" : "blob:page2",
        }),
      }),
    );

    // Mock toDataURL differently for page2 original to trigger the mock above
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
      // If height is full height (1600), check if we're on page 2
      if (fetchCalls.some((c) => c.url === "blob:page2") && !fetchCalls.some((c) => c.body?.imageBase64 === "cGFnZTItb3JpZ2luYWw=")) {
        return "data:image/jpeg;base64,cGFnZTItb3JpZ2luYWw=";
      }
      return "data:image/jpeg;base64,c2xpY2U=";
    });

    await act(async () => {
      await result.current.handleTranslateAll();
    });

    // Batch should complete with 0 failures
    expect(result.current.batchFailures).toHaveLength(0);

    // Both pages should have translation bubbles cached
    expect(result.current.bubbleCacheRef.current.get("blob:page1")).toBeDefined();
    expect(result.current.bubbleCacheRef.current.get("blob:page2")).toBeDefined();
  });

  it("recovers safety-blocked page via Bubble Crop Pack when CTD cleaning regions exist", async () => {
    const fetchCalls: { url: string; body?: any }[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      fetchCalls.push({ url, body });

      if (url.startsWith("blob:")) {
        return new Response(new Blob(["mock-image"], { type: "image/png" }), { status: 200 });
      }

      if (url === "/api/translate") {
        // Whole-page request: returns SAFETY_BLOCKED
        if (!body?.cropPack) {
          return Response.json(
            { error: "SAFETY_BLOCKED", message: "Prompt blocked by Gemini Safety: OTHER" },
            { status: 400 },
          );
        }

        // Crop pack request: succeeds with crop index and relative box!
        return Response.json({
          text: JSON.stringify({
            bubbles: [
              {
                crop: 1,
                box: [100, 100, 900, 900],
                t: "ข้อความในกล่อง crop",
              },
            ],
          }),
          meta: { ladderStep: "crop", model: "gemini-3.5-flash-lite" },
        });
      }

      if (url === "/api/translation-review") {
        return Response.json({ reviews: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const cleaningMap = new Map();
    cleaningMap.set("blob:original", {
      width: 1000,
      height: 1600,
      regions: [
        {
          id: "r1",
          rect: { x: 100, y: 100, width: 200, height: 150 },
        },
      ],
    });

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: ["blob:original"],
        viewMode: "single",
        cleaningResultsByPage: cleaningMap,
        preparePageForTranslation: async () => ({
          recognitionUrl: "blob:original",
          backgroundUrl: "blob:clean",
        }),
      }),
    );

    let success = false;
    await act(async () => {
      success = await result.current.handleTranslate();
    });

    expect(success).toBe(true);

    // Verify calls: call 1 (whole-page, blocked) + call 2 (cropPack, succeeds) = exactly 2 calls!
    const translateCalls = fetchCalls.filter((c) => c.url === "/api/translate");
    expect(translateCalls.length).toBe(2);
    expect(translateCalls[1].body?.cropPack?.crops).toHaveLength(1);

    // Cached bubbles must contain the recovered and remapped bubble
    const cached = result.current.bubbleCacheRef.current.get("blob:original");
    expect(cached).toBeDefined();
    expect(cached!).toHaveLength(1);
    expect(cached![0].t).toBe("ข้อความในกล่อง crop");
    // Ensure "crop" property was deleted during remapping
    expect((cached![0] as any).crop).toBeUndefined();
  });
});
