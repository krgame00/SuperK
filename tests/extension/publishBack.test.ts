import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  POST as publishEndpoint,
  GET as getPublishedEndpoint,
  _resetPublishedForTest,
} from "@/src/app/api/extension/publish-back/handler";
import { _resetPairingTokenForTest } from "@/lib/server/pairing";
import { createPageTargetIdentity } from "@/lib/extension/strictParity";
import { withReviewIdentity } from "@/lib/translation/qualityReview";
import { inspectedBackgroundEvidence, TEST_CLEAN_DATA_URL } from "../helpers/extensionBackgroundEvidence";

const SOURCE_REVISION = "a".repeat(64);
function publication(pageUrl: string, text: string) {
  return {
    pageUrl,
    originUrl: "https://manga.example.com/chapter-5",
    targetIdentity: createPageTargetIdentity("en"),
    sourceRevision: SOURCE_REVISION,
    ...inspectedBackgroundEvidence(SOURCE_REVISION),
    cleanUrl: TEST_CLEAN_DATA_URL,
    bubbles: [{
      t: text,
      original_text: "Original text",
      box: [100, 100, 300, 300],
      translationReview: withReviewIdentity({status:"ok",sourceText:"Original text",reviewedText:text},"en",SOURCE_REVISION),
    }],
  };
}

describe("Bidirectional Publishing Protocol (Ticket 05)", () => {
  beforeEach(() => {
    _resetPublishedForTest();
    _resetPairingTokenForTest("test-token");
  });

  describe("API /api/extension/publish-back", () => {
    it("rejects request without pageUrl", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000", authorization: "Bearer test-token" },
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
        headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000", authorization: "Bearer test-token" },
        body: JSON.stringify({
          ...publication("https://manga.example.com/chapter-5/page-2.png", "Edited translation is ready!"),
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
          headers: { origin: "chrome-extension://my-extension", authorization: "Bearer test-token" },
        }
      );

      const getRes = await getPublishedEndpoint(getReq);
      expect(getRes.status).toBe(200);
      const getData = await getRes.json();
      expect(getData.pageUrl).toBe("https://manga.example.com/chapter-5/page-2.png");
      expect(getData.bubbles[0].t).toBe("Edited translation is ready!");
      expect(getData.textStyle.fontSizeMultiplier).toBe(1.2);
    });

    it("allows polling for published updates since timestamp", async () => {
      const now = Date.now();
      const req = new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000", authorization: "Bearer test-token" },
        body: JSON.stringify(publication("https://manga.example.com/p1.jpg", "Translation update")),
      });
      await publishEndpoint(req);

      const pollReq = new NextRequest(
        `http://127.0.0.1:3000/api/extension/publish-back?since=${now - 1000}`,
        {
          method: "GET",
          headers: { origin: "chrome-extension://my-extension", authorization: "Bearer test-token" },
        }
      );

      const pollRes = await getPublishedEndpoint(pollReq);
      expect(pollRes.status).toBe(200);
      const pollData = await pollRes.json();
      expect(Array.isArray(pollData.updates)).toBe(true);
      expect(pollData.updates.length).toBe(1);
      expect(pollData.updates[0].pageUrl).toBe("https://manga.example.com/p1.jpg");
    });

    it("assigns strictly increasing sequence IDs and filters with id > cursor (no duplicate replay)", async () => {
      // 1. Publish first update
      const post1 = await publishEndpoint(
        new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000", authorization: "Bearer test-token" },
          body: JSON.stringify(publication("https://manga.example.com/p1.jpg", "First")),
        }),
      );
      const data1 = await post1.json();
      expect(data1.seq).toBeGreaterThan(0);
      const seq1 = data1.seq;

      // 2. Publish second update
      const post2 = await publishEndpoint(
        new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000", authorization: "Bearer test-token" },
          body: JSON.stringify(publication("https://manga.example.com/p2.jpg", "Second")),
        }),
      );
      const data2 = await post2.json();
      expect(data2.seq).toBeGreaterThan(seq1);
      const seq2 = data2.seq;

      // 3. Poll with cursor = seq1: only seq2 is returned, seq1 is excluded
      const pollReq = new NextRequest(
        `http://127.0.0.1:3000/api/extension/publish-back?sinceSeq=${seq1}`,
        {
          method: "GET",
          headers: { origin: "chrome-extension://my-extension", authorization: "Bearer test-token" },
        },
      );
      const pollRes = await getPublishedEndpoint(pollReq);
      const pollData = await pollRes.json();
      expect(pollData.updates.length).toBe(1);
      expect(pollData.updates[0].pageUrl).toBe("https://manga.example.com/p2.jpg");
      expect(pollData.updates[0].seq).toBe(seq2);

      // 4. Repeated poll with cursor = seq2: returns 0 updates (strict > cursor deduplication)
      const repeatPollReq = new NextRequest(
        `http://127.0.0.1:3000/api/extension/publish-back?sinceSeq=${seq2}`,
        {
          method: "GET",
          headers: { origin: "chrome-extension://my-extension", authorization: "Bearer test-token" },
        },
      );
      const repeatPollRes = await getPublishedEndpoint(repeatPollReq);
      const repeatPollData = await repeatPollRes.json();
      expect(repeatPollData.updates.length).toBe(0);
    });

    it("returns updates strictly sorted by seq ascending even when existing keys are updated", async () => {
      // 1. Post p1 (seq: 1)
      await publishEndpoint(
        new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000", authorization: "Bearer test-token" },
          body: JSON.stringify(publication("https://manga.example.com/p1.jpg", "1")),
        }),
      );

      // 2. Post p2 (seq: 2)
      await publishEndpoint(
        new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000", authorization: "Bearer test-token" },
          body: JSON.stringify(publication("https://manga.example.com/p2.jpg", "2")),
        }),
      );

      // 3. Re-post p1 (seq: 3) - in JS Map, p1 stays at index 0 of insertion order
      await publishEndpoint(
        new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000", authorization: "Bearer test-token" },
          body: JSON.stringify(publication("https://manga.example.com/p1.jpg", "2")),
        }),
      );

      // 4. Poll all updates
      const pollReq = new NextRequest(
        "http://127.0.0.1:3000/api/extension/publish-back",
        {
          method: "GET",
          headers: { origin: "chrome-extension://my-extension", authorization: "Bearer test-token" },
        },
      );
      const pollRes = await getPublishedEndpoint(pollReq);
      const pollData = await pollRes.json();
      expect(pollData.updates.length).toBe(2);
      expect(pollData.updates[0].pageUrl).toBe("https://manga.example.com/p2.jpg");
      expect(pollData.updates[0].seq).toBe(2);
      expect(pollData.updates[1].pageUrl).toBe("https://manga.example.com/p1.jpg");
      expect(pollData.updates[1].seq).toBe(3);
    });
  });

  describe("pairing token gate", () => {
    it("rejects publish and sync without a pairing token with 401", async () => {
      const post = await publishEndpoint(
        new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000" },
          body: JSON.stringify({ pageUrl: "https://m.test/p.png", bubbles: [] }),
        }),
      );
      expect(post.status).toBe(401);

      const get = await getPublishedEndpoint(
        new NextRequest("http://127.0.0.1:3000/api/extension/publish-back?since=0", {
          headers: { origin: "http://127.0.0.1:3000" },
        }),
      );
      expect(get.status).toBe(401);
    });

    it("rejects a wrong token with 401", async () => {
      const res = await publishEndpoint(
        new NextRequest("http://127.0.0.1:3000/api/extension/publish-back", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            origin: "http://127.0.0.1:3000",
            authorization: "Bearer wrong-token",
          },
          body: JSON.stringify({ pageUrl: "https://m.test/p.png", bubbles: [] }),
        }),
      );
      expect(res.status).toBe(401);
    });
  });
});
