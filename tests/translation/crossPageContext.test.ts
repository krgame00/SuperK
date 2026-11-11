import { describe, expect, it } from "vitest";
import {
  buildCrossPageContextString,
  collectPreviousPagesContext,
  extractPageDialogueSnapshot,
  type PageDialogueSnapshot,
} from "@/lib/translation/crossPageContext";
import { type TranslatedBubble } from "@/lib/translationOverlay";

describe("Cross-Page Context Aggregator (Blueprint & Torii Parity)", () => {
  describe("extractPageDialogueSnapshot", () => {
    it("extracts non-deleted dialogue bubbles with source and translation", () => {
      const bubbles: Partial<TranslatedBubble>[] = [
        {
          id: "b1",
          original_text: "おはよう",
          t: "อรุณสวัสดิ์",
          deleted: false,
          box: [50, 700, 100, 850],
        },
        {
          id: "b2",
          original_text: "田中くん",
          t: "ทานากะคุง",
          deleted: false,
          box: [120, 680, 160, 800],
        },
        {
          id: "b3_deleted",
          original_text: "ゴミ",
          t: "ขยะ",
          deleted: true,
          box: [300, 100, 350, 200],
        },
      ];

      const snapshot = extractPageDialogueSnapshot(
        bubbles as TranslatedBubble[],
        0,
        "chapter1_01.jpg",
      );

      expect(snapshot).not.toBeNull();
      expect(snapshot?.pageIndex).toBe(0);
      expect(snapshot?.pageName).toBe("chapter1_01.jpg");
      expect(snapshot?.lines).toHaveLength(2);
      expect(snapshot?.lines[0].translatedText).toBe("อรุณสวัสดิ์");
      expect(snapshot?.lines[0].sourceText).toBe("おはよう");
      expect(snapshot?.lines[1].translatedText).toBe("ทานากะคุง");
    });

    it("returns null when no eligible translated bubbles exist", () => {
      expect(extractPageDialogueSnapshot([], 0)).toBeNull();
      const deletedOnly: Partial<TranslatedBubble>[] = [
        { id: "del", t: "ข้อความ", deleted: true, box: [10, 10, 20, 20] },
      ];
      expect(
        extractPageDialogueSnapshot(deletedOnly as TranslatedBubble[], 0),
      ).toBeNull();
    });
  });

  describe("buildCrossPageContextString", () => {
    it("formats multiple page snapshots into prompt-ready context directive", () => {
      const snapshots: PageDialogueSnapshot[] = [
        {
          pageIndex: 0,
          pageName: "page_01.png",
          lines: [
            { sourceText: "俺はルフィ", translatedText: "ฉันชื่อลูฟี่" },
            { sourceText: "海賊王になる男だ", translatedText: "ชายที่จะเป็นราชาโจรสลัด" },
          ],
        },
        {
          pageIndex: 1,
          lines: [
            { sourceText: "よろしくな", translatedText: "ฝากเนื้อฝากตัวด้วยนะ" },
          ],
        },
      ];

      const result = buildCrossPageContextString(snapshots);
      expect(result).toContain("[Page 1 (page_01.png)]");
      expect(result).toContain('- "俺はルフィ" -> "ฉันชื่อลูฟี่"');
      expect(result).toContain("[Page 2]");
      expect(result).toContain('- "よろしくな" -> "ฝากเนื้อฝากตัวด้วยนะ"');
    });

    it("clamps lines per page according to maxLinesPerPage", () => {
      const manyLines = Array.from({ length: 20 }, (_, i) => ({
        sourceText: `Source ${i + 1}`,
        translatedText: `Translation ${i + 1}`,
      }));

      const snapshot: PageDialogueSnapshot = {
        pageIndex: 0,
        lines: manyLines,
      };

      const result = buildCrossPageContextString([snapshot], {
        maxLinesPerPage: 5,
      });

      const lineMatches = result.match(/->/g);
      expect(lineMatches).toHaveLength(5);
    });

    it("respects maxContextChars budget to prevent context window bloat", () => {
      const snap1: PageDialogueSnapshot = {
        pageIndex: 0,
        lines: [
          {
            sourceText: "A".repeat(50),
            translatedText: "B".repeat(50),
          },
        ],
      };
      const snap2: PageDialogueSnapshot = {
        pageIndex: 1,
        lines: [
          {
            sourceText: "C".repeat(50),
            translatedText: "D".repeat(50),
          },
        ],
      };

      // Set small character budget that fits page 1 but rejects page 2
      const result = buildCrossPageContextString([snap1, snap2], {
        maxContextChars: 130,
      });

      expect(result).toContain("[Page 1]");
      expect(result).not.toContain("[Page 2]");
    });
  });

  describe("collectPreviousPagesContext", () => {
    it("collects up to 3 prior pages for page 4", () => {
      const pages = ["p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg", "p5.jpg"];
      const cache = new Map<string, TranslatedBubble[]>([
        [
          "p1.jpg",
          [{ id: "1", t: "คำแปลหน้า 1", box: [10, 10, 50, 50] } as TranslatedBubble],
        ],
        [
          "p2.jpg",
          [{ id: "2", t: "คำแปลหน้า 2", box: [10, 10, 50, 50] } as TranslatedBubble],
        ],
        [
          "p3.jpg",
          [{ id: "3", t: "คำแปลหน้า 3", box: [10, 10, 50, 50] } as TranslatedBubble],
        ],
      ]);

      // Translating page 4 (index 3)
      const contextStr = collectPreviousPagesContext(
        pages,
        3,
        (url) => cache.get(url),
        { maxPreviousPages: 3 },
      );

      expect(contextStr).toContain("[Page 1]");
      expect(contextStr).toContain("[Page 2]");
      expect(contextStr).toContain("[Page 3]");
      expect(contextStr).toContain("คำแปลหน้า 1");
      expect(contextStr).toContain("คำแปลหน้า 2");
      expect(contextStr).toContain("คำแปลหน้า 3");
    });

    it("returns empty string for first page (index 0)", () => {
      const pages = ["p1.jpg", "p2.jpg"];
      const result = collectPreviousPagesContext(pages, 0, () => []);
      expect(result).toBe("");
    });
  });
});
