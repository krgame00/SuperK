import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslation } from "@/hooks/useTranslation";

vi.mock("@/lib/colorMatching/canvasSampler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/colorMatching/canvasSampler")>()),
  sampleBubbleRegion: vi.fn(() => null),
}));

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(async (firstArg: unknown, ...restArgs: unknown[]) => {
    const normalizedCall = Array.isArray(firstArg)
      ? { onComplete: restArgs[4] }
      : (firstArg as Record<string, unknown>);
    const { onComplete } = normalizedCall as { onComplete?: (dataUrl: string) => void };
    onComplete?.("data:interactive");
  }),
}));

vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
}));

describe("Phase 1: Per-page Translation Failure State", () => {
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

  it("sets per-page translation failure when whole-page and slicing fail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("blob:")) {
        return new Response(new Blob(["mock-image"], { type: "image/png" }), { status: 200 });
      }
      if (url === "/api/translate") {
        return Response.json(
          { error: "SAFETY_BLOCKED", message: "Prompt blocked by Gemini Safety: OTHER" },
          { status: 400 },
        );
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: ["blob:page1"],
        viewMode: "single",
        preparePageForTranslation: async () => ({
          recognitionUrl: "blob:page1",
          backgroundUrl: "blob:clean1",
        }),
      }),
    );

    // Initial state: no page failures
    expect(result.current.pageTranslationFailures).toBeDefined();
    expect(result.current.pageTranslationFailures["blob:page1"]).toBeUndefined();

    // Perform translation that fails
    await act(async () => {
      await result.current.handleTranslate();
    });

    // Expect per-page failure recorded with code, message, and cropOutcome
    const failure = result.current.pageTranslationFailures["blob:page1"];
    expect(failure).toBeDefined();
    expect(failure.status).toBe("failed");
    expect(failure.code).toBe("SAFETY_BLOCKED");
    expect(failure.at).toBeGreaterThan(0);
    expect(failure.cropOutcome).toBe("crop:skipped-no-regions");
  });

  it("clears per-page translation failure when page translates successfully", async () => {
    let shouldFail = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("blob:")) {
        return new Response(new Blob(["mock-image"], { type: "image/png" }), { status: 200 });
      }
      if (url === "/api/translate") {
        if (shouldFail) {
          return Response.json(
            { error: "SAFETY_BLOCKED", message: "Prompt blocked by Gemini Safety: OTHER" },
            { status: 400 },
          );
        }
        return Response.json({
          text: JSON.stringify({
            bubbles: [{ box: [100, 100, 200, 200], t: "แปลสำเร็จ" }],
          }),
        });
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: ["blob:page1"],
        viewMode: "single",
        preparePageForTranslation: async () => ({
          recognitionUrl: "blob:page1",
          backgroundUrl: "blob:clean1",
        }),
      }),
    );

    // Run first: fails
    await act(async () => {
      await result.current.handleTranslate();
    });
    expect(result.current.pageTranslationFailures["blob:page1"]).toBeDefined();

    // Run second: succeeds
    shouldFail = false;
    await act(async () => {
      await result.current.handleTranslate();
    });

    // Failure must be cleared
    expect(result.current.pageTranslationFailures["blob:page1"]).toBeUndefined();
  });

  it("recovers via crop pack without context thumbnail when full thumbnail triggers SAFETY_BLOCKED", async () => {
    const cleaningResultsByPage = new Map<string, any>([
      [
        "blob:page1",
        {
          width: 1000,
          height: 1600,
          cleanUrl: "blob:clean1",
          regions: [
            {
              id: "reg1",
              rect: { x: 100, y: 100, width: 200, height: 200 },
              status: "cleaned",
            },
          ],
        },
      ],
    ]);

    let cropPackAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("blob:")) {
        return new Response(new Blob(["mock-image"], { type: "image/png" }), { status: 200 });
      }
      if (url === "/api/translate") {
        const body = JSON.parse(String(init?.body || "{}"));
        if (!body.cropPack) {
          // Whole-page attempt is blocked by safety
          return Response.json(
            { error: "SAFETY_BLOCKED", message: "Prompt blocked by Gemini Safety: OTHER" },
            { status: 400 },
          );
        }
        cropPackAttempts++;
        if (!body.cropPack.omitContextThumbnail) {
          // First crop pack with full page thumbnail is also blocked by safety
          return Response.json(
            { error: "SAFETY_BLOCKED", message: "Prompt blocked by Gemini Safety: OTHER" },
            { status: 400 },
          );
        }
        // Second crop pack without context thumbnail succeeds!
        return Response.json({
          text: JSON.stringify({
            bubbles: [
              {
                crop: 1,
                box: [100, 100, 900, 900],
                t: "แปลสำเร็จจาก crop",
              },
            ],
          }),
          meta: { ladderStep: "crop", model: "gemini-3.5-flash-lite" },
        });
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: ["blob:page1"],
        viewMode: "single",
        cleaningResultsByPage,
        preparePageForTranslation: async () => ({
          recognitionUrl: "blob:page1",
          backgroundUrl: "blob:clean1",
        }),
      }),
    );

    await act(async () => {
      await result.current.handleTranslate();
    });

    // Succeeded via crop pack (2 attempts: with thumbnail -> without thumbnail)
    expect(cropPackAttempts).toBe(2);
    expect(result.current.pageTranslationFailures["blob:page1"]).toBeUndefined();
    const cached = result.current.bubbleCacheRef.current.get("blob:page1");
    expect(cached).toBeDefined();
    expect(cached!.length).toBeGreaterThan(0);
    expect(cached![0].t).toBe("แปลสำเร็จจาก crop");
  });

  it("records crop:request-failed:SAFETY_BLOCKED when both crop pack attempts fail", async () => {
    const cleaningResultsByPage = new Map<string, any>([
      [
        "blob:page1",
        {
          width: 1000,
          height: 1600,
          cleanUrl: "blob:clean1",
          regions: [
            {
              id: "reg1",
              rect: { x: 100, y: 100, width: 200, height: 200 },
              status: "cleaned",
            },
          ],
        },
      ],
    ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("blob:")) {
        return new Response(new Blob(["mock-image"], { type: "image/png" }), { status: 200 });
      }
      if (url === "/api/translate") {
        return Response.json(
          { error: "SAFETY_BLOCKED", message: "Prompt blocked by Gemini Safety: OTHER" },
          { status: 400 },
        );
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: ["blob:page1"],
        viewMode: "single",
        cleaningResultsByPage,
        preparePageForTranslation: async () => ({
          recognitionUrl: "blob:page1",
          backgroundUrl: "blob:clean1",
        }),
      }),
    );

    await act(async () => {
      await result.current.handleTranslate();
    });

    const failure = result.current.pageTranslationFailures["blob:page1"];
    expect(failure).toBeDefined();
    expect(failure.status).toBe("failed");
    expect(failure.code).toBe("SAFETY_BLOCKED");
    expect(failure.cropOutcome).toBe("crop:request-failed:SAFETY_BLOCKED");
  });
});
