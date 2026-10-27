import { describe, it, expect } from "vitest";
import {
  formatTranscriptText,
  parseTranscriptText,
  type TranscriptPageData,
} from "@/components/editing/TranscriptModal";
import { generatePhotoshopBuildScript } from "@/lib/export/exportManager";

describe("TranscriptModal & Layered Export", () => {
  const samplePages: TranscriptPageData[] = [
    {
      pageIndex: 0,
      pageName: "page_001.png",
      pageUrl: "blob:page1",
      bubbles: [
        {
          t: "สวัสดีครับ",
          translated: "สวัสดีครับ",
          original_text: "こんにちは",
          box: [100, 200, 300, 400],
        },
        {
          t: "ข้อความที่ถูกลบ",
          translated: "ข้อความที่ถูกลบ",
          original_text: "削除",
          box: [400, 200, 500, 400],
          deleted: true,
        },
        {
          t: "สบายดีไหม",
          translated: "สบายดีไหม",
          original_text: "元気ですか",
          box: [600, 200, 700, 400],
        },
      ],
    },
    {
      pageIndex: 1,
      pageName: "page_002.png",
      pageUrl: "blob:page2",
      bubbles: [
        {
          t: "ขอบคุณมาก",
          translated: "ขอบคุณมาก",
          original_text: "ありがとう",
          box: [150, 250, 350, 450],
        },
      ],
    },
  ];

  it("formats transcript text correctly for current page and skips deleted bubbles", () => {
    const text = formatTranscriptText(samplePages, "current", 0);
    expect(text).toContain("=== [Page 1: page_001.png] ===");
    expect(text).toContain("#1 [ORIG]: こんにちは");
    expect(text).toContain("#1 [TRAN]: สวัสดีครับ");
    expect(text).not.toContain("ข้อความที่ถูกลบ");
    // Bubble at index 2 should have #3 label so the index is stable
    expect(text).toContain("#3 [ORIG]: 元気ですか");
    expect(text).toContain("#3 [TRAN]: สบายดีไหม");
    expect(text).not.toContain("=== [Page 2");
  });

  it("formats transcript text for all pages", () => {
    const text = formatTranscriptText(samplePages, "all", 0);
    expect(text).toContain("=== [Page 1: page_001.png] ===");
    expect(text).toContain("=== [Page 2: page_002.png] ===");
    expect(text).toContain("#1 [TRAN]: ขอบคุณมาก");
  });

  it("parses edited transcript text and returns index map without drifting", () => {
    const rawEdited = `
=== [Page 1: page_001.png] ===
#1 [ORIG]: こんにちは
#1 [TRAN]: อรุณสวัสดิ์ครับ

#3 [ORIG]: 元気ですか
#3 [TRAN]: สบายดีหรือเปล่าครับ

=== [Page 2: page_002.png] ===
#1 [ORIG]: ありがとう
#1 [TRAN]: ขอบพระคุณครับ
    `;

    const updates = parseTranscriptText(rawEdited, samplePages, "all", 0);
    expect(updates.has("blob:page1")).toBe(true);
    expect(updates.has("blob:page2")).toBe(true);

    const page1Map = updates.get("blob:page1")!;
    expect(page1Map.get(0)).toBe("อรุณสวัสดิ์ครับ");
    // Index 1 was deleted, so no edit for index 1
    expect(page1Map.has(1)).toBe(false);
    // Index 2 is properly preserved
    expect(page1Map.get(2)).toBe("สบายดีหรือเปล่าครับ");

    const page2Map = updates.get("blob:page2")!;
    expect(page2Map.get(0)).toBe("ขอบพระคุณครับ");
  });

  it("generates Photoshop JSX build script with center justification and correct coordinates", () => {
    const jsx = generatePhotoshopBuildScript(1, "raw.png", "clean.png", [
      {
        t: "สวัสดี",
        original_text: "Hi",
        box: [200, 300, 400, 500],
      },
    ]);

    expect(jsx).toContain('#target photoshop');
    expect(jsx).toContain('raw.png');
    expect(jsx).toContain('clean.png');
    expect(jsx).toContain('ti.justification = Justification.CENTER;');
    expect(jsx).toContain('ti.contents = b.text;');
  });
});
