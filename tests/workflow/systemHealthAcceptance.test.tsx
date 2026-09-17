// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveProjectSession, loadProjectSession, clearProjectSession } from "@/lib/projectStore";
import { WorkspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";
import { shouldReuseCachedTranslatedRender, shouldReuseSpilledTranslatedRender } from "@/lib/export/renderFreshness";
import { blobToDataUrl } from "@/lib/imageDataUrl";
import "@/chrome-extension/server.js";

declare const SuperKServer: {
  getDirectExecutionRoutes: (rawApiKeys: string, options?: { modelPreference?: string }) => Array<{ model: string; apiKey: string }>;
  FIXED_AUTO_MODELS: string[];
};

describe("End-to-End System Health Remediation Acceptance (P0-P4)", () => {
  beforeEach(async () => {
    await clearProjectSession();
    vi.restoreAllMocks();
  });

  describe("P0: Source Persistence & Reload Durability", () => {
    it("converts imported Blobs to durable data URLs so reloads never depend on revoked blob URLs", async () => {
      const sourceBlob = new Blob(["test-manga-image-binary-data"], { type: "image/png" });
      const durableUrl = await blobToDataUrl(sourceBlob);

      expect(durableUrl.startsWith("data:image/png;base64,")).toBe(true);
      expect(durableUrl.startsWith("blob:")).toBe(false);

      // Save session with durable URL
      await saveProjectSession({
        pages: [{ url: durableUrl, name: "ch1_p01.png" }],
        currentPage: 0,
        bubbleCache: new Map([[durableUrl, [{ t: "คำแปลแรก", box: [10, 10, 50, 50] } as any]]]),
        translatedImageCache: new Map(),
      });

      // Restore session
      const restored = await loadProjectSession();
      expect(restored).not.toBeNull();
      expect(restored?.hasUnrecoverableSources).toBe(false);
      expect(restored?.pages[0].url).toBe(durableUrl);
      expect(restored?.bubbleCache.get(durableUrl)?.[0].t).toBe("คำแปลแรก");
    });

    it("detects and flags legacy sessions containing expired blob: URLs as unrecoverable", async () => {
      const deadBlobUrl = "blob:http://127.0.0.1:3000/dead-uuid-999";
      await saveProjectSession({
        pages: [{ url: deadBlobUrl, name: "legacy_p01.png" }],
        currentPage: 0,
        bubbleCache: new Map([[deadBlobUrl, [{ t: "คำแปลเก่า", box: [0, 0, 10, 10] } as any]]]),
        translatedImageCache: new Map(),
      });

      const restored = await loadProjectSession();
      expect(restored).not.toBeNull();
      expect(restored?.hasUnrecoverableSources).toBe(true);
      expect(restored?.pages[0].unrecoverableSource).toBe(true);
      // Translation metadata must be preserved so user can re-import source
      expect(restored?.bubbleCache.has(deadBlobUrl)).toBe(true);
    });
  });

  describe("P1: Revision-Safe Render Cache & Export Freshness", () => {
    it("strictly forbids reusing in-memory or spilled render when page revision changes", () => {
      const manager = new WorkspaceResourceManager({ minCapMB: 5, maxCapMB: 5 });
      const pageId = "p1";

      // 1. Initial translation render at rev-1
      manager.registerRenderedImage(pageId, "rev-1", "data:rendered-v1", 100);

      // 2. Verified: returns render when asking for rev-1
      expect(manager.restoreRenderedImage(pageId, "rev-1")).toBe("data:rendered-v1");

      // 3. User modifies text / moves bubble -> rev-2
      // Must NOT return stale v1 render!
      expect(manager.restoreRenderedImage(pageId, "rev-2")).toBeNull();

      // 4. Register new render at rev-2
      manager.registerRenderedImage(pageId, "rev-2", "data:rendered-v2", 100);
      expect(manager.restoreRenderedImage(pageId, "rev-2")).toBe("data:rendered-v2");
    });

    it("spills with actual revision signature upon budget eviction and verifies signature on spill restore", () => {
      const manager = new WorkspaceResourceManager({ minCapMB: 2, maxCapMB: 2 });

      // Register p1 at rev-1 (~1.5 MB)
      manager.registerRenderedImage("p1", "rev-1", "data:rendered-p1-v1", 1.5 * 1024 * 1024);

      // Register p2 at rev-1 (~1.5 MB) -> evicts cold p1 into spill cache
      manager.registerRenderedImage("p2", "rev-1", "data:rendered-p2-v1", 1.5 * 1024 * 1024);

      // p1 is spilled with signature "rev-1".
      // Requesting rev-2 from spill must return null and purge stale entry
      expect(manager.restoreRenderedImage("p1", "rev-2")).toBeNull();

      // If user had not changed revision, restoring with rev-1 works
      // (Re-register p1 to evict and test valid spill restore)
      manager.registerRenderedImage("p3", "rev-1", "data:rendered-p3-v1", 1.5 * 1024 * 1024);
      // p2 is now spilled with rev-1
      expect(manager.restoreRenderedImage("p2", "rev-1")).toBe("data:rendered-p2-v1");
    });

    it("export dirty gate flags dirty pages for complete re-render instead of reusing stale cache", () => {
      // Dirty page must reject cached render
      expect(shouldReuseCachedTranslatedRender(true)).toBe(false);
      expect(shouldReuseCachedTranslatedRender(false)).toBe(true);

      // If page has active bubbles, spill cache must not silently be reused
      expect(shouldReuseSpilledTranslatedRender([{ t: "คำแปลล่าสุด", box: [1, 2, 3, 4] }])).toBe(false);
      expect(shouldReuseSpilledTranslatedRender([])).toBe(true);
    });
  });

  describe("P2: Chrome Extension Direct Routing Parity with Server", () => {
    it("Direct Auto mode routes identically to Server fixed hierarchy starting with gemini-3.5-flash-lite", () => {
      const routes = SuperKServer.getDirectExecutionRoutes("key1,key2", { modelPreference: "auto" });

      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0].model).toBe("gemini-3.5-flash-lite");
      expect(routes[0].apiKey).toBe("key1");
      expect(routes[1].apiKey).toBe("key2");

      // Verify hierarchy matches Server Mode
      const uniqueModels = [...new Set(routes.map(r => r.model))];
      expect(uniqueModels).toEqual([
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
      ]);
    });

    it("Direct Manual model preference respects user selection without changing model", () => {
      const routes = SuperKServer.getDirectExecutionRoutes("key1,key2", { modelPreference: "gemini-3-flash" });
      expect(routes.every(r => r.model === "gemini-3-flash")).toBe(true);
      expect(routes.map(r => r.apiKey)).toEqual(["key1", "key2"]);
    });
  });
});
