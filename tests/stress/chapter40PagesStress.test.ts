import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { undoManager, DEFAULT_MAX_RASTER_UNDO_STATES } from "@/lib/undoManager";
import { assessPageGeometry, type PageGeometryInput } from "@/lib/export/readabilityScan";
import {
  formatTranscriptText,
  parseTranscriptText,
  type TranscriptPageData,
} from "@/components/editing/TranscriptModal";
import {
  generateComicInfoXml,
  generatePhotoshopBuildScript,
} from "@/lib/export/exportManager";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("40-Page Manga Chapter Stress & Performance Test Suite", () => {
  const TOTAL_PAGES = 40;
  const BUBBLES_PER_PAGE = 6;

  // Generate synthetic 40-page chapter with realistic dialogue and SFX
  function generate40PageChapter(): {
    pages: TranscriptPageData[];
    geometryPages: PageGeometryInput[];
  } {
    const transcriptPages: TranscriptPageData[] = [];
    const geometryPages: PageGeometryInput[] = [];

    const thaiPhrases = [
      "สวัสดีครับ ยินดีที่ได้พบกันนะ",
      "นี่มันเกิดอะไรขึ้นกันแน่เนี่ย!?",
      "อย่าเข้ามาใกล้นะ! ฉันเตือนเธอแล้ว!",
      "เดี๋ยวก่อนสิ... เรื่องนั้นน่ะมัน...",
      "*ตู้ม!*",
      "เข้าใจแล้วล่ะ ถ้าอย่างนั้นก็ลุยกันเลย!",
      "ผู้กล้าที่กอบกู้โลกได้กลับมาที่นี่แล้ว",
      "น้ำตาไหลออกมาไม่หยุดเลย... อุ๊ย!",
    ];

    const japanesePhrases = [
      "こんにちは、初めまして。",
      "一体何が起きているんだ！？",
      "近づくな！警告したはずだぞ！",
      "待ってくれ… それは…",
      "ドカーン！",
      "分かった、それなら行くぞ！",
      "世界を救った勇者がここに戻ってきた。",
      "涙が止まらない… あっ！",
    ];

    for (let p = 0; p < TOTAL_PAGES; p++) {
      const pageNum = p + 1;
      const pageName = `chapter_01_p${String(pageNum).padStart(3, "0")}.png`;
      const pageUrl = `blob:http://localhost:3000/page-${pageNum}`;

      const bubbles: TranslatedBubble[] = [];

      for (let b = 0; b < BUBBLES_PER_PAGE; b++) {
        const textIdx = (p * BUBBLES_PER_PAGE + b) % thaiPhrases.length;
        const isSfx = b === 4;
        const bubbleW = isSfx ? 180 : 220;
        const bubbleH = isSfx ? 90 : 160;
        const bx = 100 + (b % 3) * 260;
        const by = 150 + Math.floor(b / 3) * 450;

        bubbles.push({
          id: `p${pageNum}_b${b + 1}`,
          t: thaiPhrases[textIdx],
          translated: thaiPhrases[textIdx],
          original_text: japanesePhrases[textIdx],
          box: [by, bx, by + bubbleH, bx + bubbleW],
          targetFontSize: isSfx ? 28 : 20,
          category: isSfx ? "sfx" : "speech",
          layoutAdjustment: {
            bx,
            by,
            bw: bubbleW,
            bh: bubbleH,
            iw: 1000,
            ih: 1400,
          },
        });
      }

      transcriptPages.push({
        pageIndex: p,
        pageName,
        pageUrl,
        bubbles,
      });

      geometryPages.push({
        pageUrl,
        pageIndex: p,
        width: 1000,
        height: 1400,
        bubbles,
      });
    }

    return { pages: transcriptPages, geometryPages };
  }

  beforeEach(() => {
    undoManager.clear();
  });

  afterEach(() => {
    undoManager.clear();
  });

  describe("1. Dual-Tier Memory Management under 40-Page High-Frequency Edits", () => {
    it("strictly bounds raster undo states to 8 while allowing up to 50 generic actions across 40 pages", () => {
      const disposedRasterHolders: number[] = [];

      // Simulate user editing across all 40 pages
      for (let p = 0; p < TOTAL_PAGES; p++) {
        // Generic text/layout edit
        undoManager.push({
          label: `Edit Page ${p + 1} Dialogue`,
          kind: "generic",
          undo: vi.fn(),
          redo: vi.fn(),
        });

        // Periodic raster inpainting brush stroke on alternating pages
        if (p % 2 === 0) {
          const rasterId = p;
          const rasterBuffer = new Uint8Array(1024 * 1024); // 1MB mock bitmap
          undoManager.push({
            label: `Brush Clean Page ${p + 1}`,
            kind: "raster",
            undo: vi.fn(),
            redo: vi.fn(),
            dispose: () => {
              disposedRasterHolders.push(rasterId);
              // Explicit buffer release
              rasterBuffer.fill(0);
            },
          });
        }
      }

      // 40 generic actions + 20 raster actions were pushed = 60 actions total
      // Total actions should be capped at max (50)
      expect(undoManager.getStackSize()).toBeLessThanOrEqual(50);

      // Raster actions must strictly be capped at DEFAULT_MAX_RASTER_UNDO_STATES = 8
      expect(undoManager.getRasterCount()).toBeLessThanOrEqual(DEFAULT_MAX_RASTER_UNDO_STATES);

      // Therefore, of the 20 raster actions pushed, 12 must have been evicted and disposed
      expect(disposedRasterHolders.length).toBe(12);

      // Disposed actions must be the oldest raster actions (0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22)
      expect(disposedRasterHolders).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);

      // When clearing undo manager (e.g. changing chapter or closing document), remaining 8 rasters must be disposed
      undoManager.clear();
      expect(disposedRasterHolders.length).toBe(20);
      expect(undoManager.getStackSize()).toBe(0);
      expect(undoManager.getRasterCount()).toBe(0);
    });
  });

  describe("2. Chapter Preloading Window Bounding (Memory Slump Test)", () => {
    it("ensures sliding preloading window strictly restricts active images to currentPage ± 2 across 40 pages", () => {
      // Simulate PageViewer preloading logic for 40 pages
      const activeWindowPages = (currentPage: number, totalPages: number) => {
        const windowIndices = new Set<number>();
        for (let offset = -2; offset <= 2; offset++) {
          const idx = currentPage + offset;
          if (idx >= 0 && idx < totalPages) {
            windowIndices.add(idx);
          }
        }
        return windowIndices;
      };

      // Traverse through all 40 pages
      for (let cur = 0; cur < TOTAL_PAGES; cur++) {
        const activeSet = activeWindowPages(cur, TOTAL_PAGES);

        // Active window must never hold more than 5 pages
        expect(activeSet.size).toBeLessThanOrEqual(5);

        // Current page must always be active
        expect(activeSet.has(cur)).toBe(true);

        // Distant pages (e.g. > 2 pages away) must NOT be in the active preload set
        if (cur >= 5) {
          expect(activeSet.has(cur - 3)).toBe(false);
          expect(activeSet.has(0)).toBe(false);
        }
        if (cur <= TOTAL_PAGES - 6) {
          expect(activeSet.has(cur + 3)).toBe(false);
          expect(activeSet.has(TOTAL_PAGES - 1)).toBe(false);
        }
      }
    });
  });

  describe("3. Whole-Chapter Readability & Geometry Assessment Performance", () => {
    it("scans all 40 pages (240 bubbles) in under 500ms without memory exhaustion or NaN errors", () => {
      const { geometryPages } = generate40PageChapter();
      expect(geometryPages.length).toBe(TOTAL_PAGES);

      const startTime = performance.now();

      let totalFindings = 0;
      let totalMeasurements = 0;

      for (const pageInput of geometryPages) {
        const result = assessPageGeometry(pageInput);
        expect(result.unavailableReason).toBeUndefined();
        totalFindings += result.findings.length;
        totalMeasurements += result.measurements?.length ?? 0;
      }

      const durationMs = performance.now() - startTime;

      // 40 pages x 6 bubbles = 240 measured bubbles
      expect(totalMeasurements).toBe(TOTAL_PAGES * BUBBLES_PER_PAGE);

      // Performance assertion: 40 full pages assessed in under 500ms
      expect(durationMs, `Assessing 40 pages took ${durationMs.toFixed(1)}ms`).toBeLessThan(500);
    });
  });

  describe("4. Chapter-Wide Batch Transcript Synchronization", () => {
    it("formats, validates, and modifies chapter transcript across all 40 pages without off-by-N drifting", () => {
      const { pages } = generate40PageChapter();

      // 1. Format chapter transcript for all 40 pages
      const transcript = formatTranscriptText(pages, "all", 0);

      // Verify all 40 page headers are present in order
      for (let p = 1; p <= TOTAL_PAGES; p++) {
        expect(transcript).toContain(`=== [Page ${p}: chapter_01_p${String(p).padStart(3, "0")}.png] ===`);
      }

      // 2. Parse transcript back into structured updates map
      const parsedUpdates = parseTranscriptText(transcript, pages, "all", 0);
      expect(parsedUpdates.size).toBe(TOTAL_PAGES);

      // 3. Verify every bubble was mapped to the exact page without index drift
      for (let p = 0; p < TOTAL_PAGES; p++) {
        const pageUrl = pages[p].pageUrl;
        const pageUpdates = parsedUpdates.get(pageUrl);
        expect(pageUpdates, `Updates for page ${p + 1} must exist`).toBeDefined();
        expect(pageUpdates!.size).toBe(BUBBLES_PER_PAGE);

        for (let b = 0; b < BUBBLES_PER_PAGE; b++) {
          expect(pageUpdates!.has(b)).toBe(true);
          expect(pageUpdates!.get(b)).toBe(pages[p].bubbles[b].t);
        }
      }
    });
  });

  describe("5. Multi-Page Photoshop & Photopea Layered Export Script Generation", () => {
    it("generates ComicInfo.xml and ExtendScript .jsx builder scripts for all 40 pages flawlessly", () => {
      const { pages } = generate40PageChapter();

      // 1. ComicInfo.xml for 40-page chapter
      const comicInfo = generateComicInfoXml({
        title: "Chapter 1: The Beginning",
        series: "SuperK Manga",
        pageCount: TOTAL_PAGES,
        languageISO: "th",
        translator: "SuperK Automated Pipeline",
      });

      expect(comicInfo).toContain(`<PageCount>${TOTAL_PAGES}</PageCount>`);
      expect(comicInfo).toContain("<Title>Chapter 1: The Beginning</Title>");
      expect(comicInfo).toContain("<LanguageISO>th</LanguageISO>");
      expect(comicInfo).toContain("<Manga>YesAndRightToLeft</Manga>");

      // 2. Photoshop .jsx builder scripts for all 40 pages
      const scripts: string[] = [];
      const startTime = performance.now();

      for (let p = 0; p < TOTAL_PAGES; p++) {
        const script = generatePhotoshopBuildScript(
          p + 1,
          `orig_p${p + 1}.png`,
          `clean_p${p + 1}.png`,
          pages[p].bubbles
        );
        scripts.push(script);
        expect(script).toContain(`// SuperK Layered PSD Builder Script for Page ${p + 1}`);
        expect(script).toContain("doc.activeLayer.name = \"Original Raw\";");
        expect(script).toContain("doc.activeLayer.name = \"Inpainted Clean\";");
        expect(script).toContain("textGroup.name = \"Translated Text Layers\";");
      }

      const elapsedMs = performance.now() - startTime;

      expect(scripts.length).toBe(TOTAL_PAGES);
      expect(elapsedMs, `Generating 40 page scripts took ${elapsedMs.toFixed(1)}ms`).toBeLessThan(200);
    });
  });
});
