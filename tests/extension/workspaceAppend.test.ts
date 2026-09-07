import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  clearProjectSession,
  saveProjectSession,
  loadProjectSession,
  appendPageToProjectSession,
} from "@/lib/projectStore";
import {
  POST as appendEndpoint,
  GET as handoffEndpoint,
  _resetHandoffsForTest,
} from "@/src/app/api/extension/workspace/append/route";

describe("Workspace Handoff & Session Append Protocol (Ticket 04)", () => {
  beforeEach(async () => {
    await clearProjectSession();
    _resetHandoffsForTest();
  });

  describe("projectStore.appendPageToProjectSession", () => {
    it("appends to an existing 40-page session without destroying existing pages", async () => {
      // Setup existing 40 pages
      const existingPages = Array.from({ length: 40 }, (_, i) => ({
        url: `data:image/png;base64,page${i}`,
        name: `Page ${i + 1}`,
      }));
      const bubbleCache = new Map<string, any[]>();
      bubbleCache.set(existingPages[0].url, [{ t: "คำพูดหน้า 1", box: [10, 10, 50, 50] }]);

      await saveProjectSession({
        pages: existingPages,
        currentPage: 0,
        bubbleCache,
        translatedImageCache: new Map(),
      });

      // Now append a new page from extension
      const appendResult = await appendPageToProjectSession({
        pageUrl: "https://manga.test/ch1/page41.jpg",
        cleanUrl: "data:image/png;base64,Y2xlYW5lZDQx",
        bubbles: [{ t: "คำพูดหน้าใหม่จาก Extension", box: [20, 20, 100, 100] }],
        originUrl: "https://manga.test/read/ch1",
      });

      expect(appendResult.totalPages).toBe(41);
      expect(appendResult.pageIndex).toBe(40);

      // Load session and verify all 41 pages exist
      const session = await loadProjectSession();
      expect(session).not.toBeNull();
      expect(session?.pages.length).toBe(41);
      expect(session?.pages[0].url).toBe(existingPages[0].url);
      expect(session?.pages[40].url).toBe("https://manga.test/ch1/page41.jpg");
      expect(session?.currentPage).toBe(40);

      // Check bubble cache preserved for both old and new
      expect(session?.bubbleCache.get(existingPages[0].url)?.[0].t).toBe("คำพูดหน้า 1");
      expect(session?.bubbleCache.get("https://manga.test/ch1/page41.jpg")?.[0].t).toBe("คำพูดหน้าใหม่จาก Extension");
    });

    it("creates a new session when no session previously exists", async () => {
      const appendResult = await appendPageToProjectSession({
        pageUrl: "https://manga.test/single.png",
        bubbles: [{ t: "หน้าแรก", box: [0, 0, 50, 50] }],
      });

      expect(appendResult.totalPages).toBe(1);
      expect(appendResult.pageIndex).toBe(0);

      const session = await loadProjectSession();
      expect(session?.pages.length).toBe(1);
      expect(session?.pages[0].url).toBe("https://manga.test/single.png");
    });
  });

  describe("API /api/extension/workspace/append & /handoff", () => {
    it("accepts handoff payload and allows fetching via handoff endpoint", async () => {
      const appendReq = new NextRequest("http://127.0.0.1:3000/api/extension/workspace/append", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "127.0.0.1:3000",
          origin: "chrome-extension://abcdefg",
        },
        body: JSON.stringify({
          pageUrl: "https://manga.test/p1.png",
          cleanUrl: "data:image/png;base64,clean123",
          bubbles: [{ t: "แปลแล้ว", box: [0, 0, 100, 100] }],
          originUrl: "https://manga.test/chapter/1",
        }),
      });

      const appendRes = await appendEndpoint(appendReq);
      expect(appendRes.status).toBe(200);
      const appendData = await appendRes.json();
      expect(appendData).toHaveProperty("handoffId");
      expect(appendData).toHaveProperty("editUrl");

      // Now query handoff endpoint
      const handoffReq = new NextRequest(`http://127.0.0.1:3000/api/extension/workspace/append?id=${appendData.handoffId}`, {
        method: "GET",
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      });

      const handoffRes = await handoffEndpoint(handoffReq);
      expect(handoffRes.status).toBe(200);
      const handoffData = await handoffRes.json();
      expect(handoffData.pageUrl).toBe("https://manga.test/p1.png");
      expect(handoffData.bubbles[0].t).toBe("แปลแล้ว");
      expect(handoffData.originUrl).toBe("https://manga.test/chapter/1");
    });
  });
});
