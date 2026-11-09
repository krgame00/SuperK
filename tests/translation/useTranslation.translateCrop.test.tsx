import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(),
  clearPageAdjustments: vi.fn(),
  clearAllAdjustments: vi.fn(),
  readOverlayAdjustments: vi.fn(() => ({})),
  bubbleKeyOf: vi.fn(() => "mock-key"),
}));

vi.mock("@/lib/projectStore", () => ({
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
}));

describe("translateCrop targeted OCR", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes isRetry: true and parses markdown-fenced LLM responses safely", async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      if (url === "/api/translate") {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            text: "```json\n{\"bubbles\":[{\"original_text\":\"TEST TEXT\",\"t\":\"ข้อความทดสอบ\",\"box\":[100,200,800,900]}]}\n```",
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { result } = renderHook(() =>
      useTranslation({
        pages: ["page-1"],
        currentPage: 0,
        viewMode: "single",
        preparePageForTranslation: vi.fn().mockResolvedValue({
          recognitionUrl: "page-1",
          backgroundUrl: "blob:clean-page-1",
        }),
      })
    );

    await act(async () => {
      await result.current.translateCrop(
        { x: 50, y: 100, w: 200, h: 300 },
        "fake-crop-base64",
        1000,
        1500
      );
    });

    // 1. Verify isRetry: true was passed to request high-precision retry model
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.isRetry).toBe(true);

    // 2. Verify bubbles were updated without JSON syntax error
    expect(result.current.activeBubbles.length).toBe(1);
    expect(result.current.activeBubbles[0].t).toBe("ข้อความทดสอบ");
    expect(result.current.activeBubbles[0].isManual).toBe(true);
  });
});
