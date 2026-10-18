import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExtensionWorkspaceBridge } from "@/hooks/useExtensionWorkspaceBridge";
import type { TranslatedBubble } from "@/lib/translationOverlay";

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/export/reviewGate", () => ({
  getPageOutputBlockers: vi.fn(() => ({
    targetUnconfirmed: false,
    scriptIssueCount: 0,
    unverifiedReviewCount: 0,
    backgroundBlocked: false,
  })),
}));

vi.mock("@/hooks/useWorkspaceDocumentManager", () => ({
  fetchExtensionPairingToken: vi.fn(async () => "token-mock-123"),
}));

describe("useExtensionWorkspaceBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches pairing token and syncs settings on mount", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/extension/pair") {
        return {
          ok: true,
          json: async () => ({ pairingToken: "paired_test_token" }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    globalThis.fetch = fetchMock;

    try {
      const bubbleCacheRef = { current: new Map<string, TranslatedBubble[]>() };
      const pageTargetCacheRef = { current: new Map<string, string>() };

      const { result } = renderHook(() =>
        useExtensionWorkspaceBridge({
          pages: [{ url: "http://example.com/p1.jpg", name: "page1.jpg" }],
          currentPage: 0,
          userApiKey: "key-123",
          modelPreference: "auto",
          allowPreviewModels: false,
          glossary: [],
          textStyle: {
            fontFamily: "sans-serif",
            fontSizeMultiplier: 1.0,
            textColor: "#000000",
            textOutline: "#ffffff",
          },
          targetLang: "th",
          sourceLang: "ja",
          bubbleCacheRef,
          pageTargetCacheRef,
          getExpectedRemnantEvidence: vi.fn(),
          cleaningResultsByPage: new Map(),
          exportInputSignature: vi.fn(() => "sig_123"),
          collectExportReviewPages: vi.fn(() => []),
        }),
      );

      // Wait a microtask tick for pair fetch to complete
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(fetchMock).toHaveBeenCalledWith("/api/extension/pair");
      expect(result.current.pairingToken).toBe("paired_test_token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles publish back to reading view successfully", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/extension/pair") {
        return {
          ok: true,
          json: async () => ({ pairingToken: "paired_test_token" }),
        };
      }
      if (url === "/api/extension/publish-back") {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    globalThis.fetch = fetchMock;

    try {
      const bubbleCacheRef = {
        current: new Map([
          [
            "http://example.com/p1.jpg",
            [{ x: 0, y: 0, w: 10, h: 10, text: "A", translated: "ก" }],
          ],
        ]),
      };
      const pageTargetCacheRef = {
        current: new Map([["http://example.com/p1.jpg", "th"]]),
      };

      const { result } = renderHook(() =>
        useExtensionWorkspaceBridge({
          pages: [
            {
              url: "http://example.com/p1.jpg",
              originUrl: "http://reader.com/chapter/1",
              name: "page1.jpg",
            },
          ],
          currentPage: 0,
          userApiKey: "key-123",
          modelPreference: "auto",
          allowPreviewModels: false,
          glossary: [],
          textStyle: {
            fontFamily: "sans-serif",
            fontSizeMultiplier: 1.0,
            textColor: "#000000",
            textOutline: "#ffffff",
          },
          targetLang: "th",
          sourceLang: "ja",
          bubbleCacheRef,
          pageTargetCacheRef,
          getExpectedRemnantEvidence: vi.fn(),
          cleaningResultsByPage: new Map(),
          exportInputSignature: vi.fn(() => "sig_123"),
          collectExportReviewPages: vi.fn(() => []),
        }),
      );

      await act(async () => {
        await result.current.handlePublishBackToReadingView();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/extension/publish-back",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
