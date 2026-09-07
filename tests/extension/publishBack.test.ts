import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  POST as publishEndpoint,
  GET as getPublishedEndpoint,
  _resetPublishedForTest,
} from "@/src/app/api/extension/publish-back/route";

describe("Bidirectional Publishing Protocol (Ticket 05)", () => {
  beforeEach(() => {
    _resetPublishedForTest();
  });

  describe("API /api/extension/publish-back", () => {
    it("rejects request without pageUrl", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000" },
        body: JSON.stringify({ bubbles: [] }),
      });

      const res = await publishEndpoint(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("pageUrl");
    });

    it("publishes refined bubbles and allows retrieval by pageUrl", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000" },
        body: JSON.stringify({
          pageUrl: "https://manga.example.com/chapter-5/page-2.png",
          originUrl: "https://manga.example.com/chapter-5",
          bubbles: [
            {
              t: "แปลใหม่ใน SuperK Editor สำเร็จแล้ว!",
              box: [100, 100, 300, 300],
            },
          ],
          textStyle: {
            fontFamily: "Itim, sans-serif",
            fontSizeMultiplier: 1.2,
            textColor: "#000000",
            textOutline: "#FFFFFF",
          },
        }),
      });

      const postRes = await publishEndpoint(req);
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.success).toBe(true);
      expect(postData.publishedAt).toBeTypeOf("number");

      // Query by pageUrl
      const getReq = new NextRequest(
        "http://127.0.0.1:3000/api/extension/publish-back?pageUrl=" +
          encodeURIComponent("https://manga.example.com/chapter-5/page-2.png"),
        {
          method: "GET",
          headers: { origin: "chrome-extension://my-extension" },
        }
      );

      const getRes = await getPublishedEndpoint(getReq);
      expect(getRes.status).toBe(200);
      const getData = await getRes.json();
      expect(getData.pageUrl).toBe("https://manga.example.com/chapter-5/page-2.png");
      expect(getData.bubbles[0].t).toBe("แปลใหม่ใน SuperK Editor สำเร็จแล้ว!");
      expect(getData.textStyle.fontSizeMultiplier).toBe(1.2);
    });

    it("allows polling for published updates since timestamp", async () => {
      const now = Date.now();
      const req = new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000" },
        body: JSON.stringify({
          pageUrl: "https://manga.example.com/p1.jpg",
          bubbles: [{ t: "คำแปลอัปเดต", box: [10, 10, 50, 50] }],
        }),
      });
      await publishEndpoint(req);

      const pollReq = new NextRequest(
        `http://127.0.0.1:3000/api/extension/publish-back?since=${now - 1000}`,
        {
          method: "GET",
          headers: { origin: "chrome-extension://my-extension" },
        }
      );

      const pollRes = await getPublishedEndpoint(pollReq);
      expect(pollRes.status).toBe(200);
      const pollData = await pollRes.json();
      expect(Array.isArray(pollData.updates)).toBe(true);
      expect(pollData.updates.length).toBe(1);
      expect(pollData.updates[0].pageUrl).toBe("https://manga.example.com/p1.jpg");
    });
  });
});
