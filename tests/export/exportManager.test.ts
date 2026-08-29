import { describe, expect, it } from "vitest";

import {
  generateComicInfoXml,
  generatePageFilename,
  generateStripFilename,
  sanitizeExportFilename,
} from "@/lib/export/exportManager";

describe("sanitizeExportFilename", () => {
  it("removes illegal filesystem characters on Windows and Unix", () => {
    expect(sanitizeExportFilename('Manga/Chapter:1*?page"1<test>|out.png')).toBe(
      "Manga_Chapter_1__page_1_test__out.png",
    );
  });

  it("handles empty or blank names with fallback", () => {
    expect(sanitizeExportFilename("", "fallback_name")).toBe("fallback_name");
    expect(sanitizeExportFilename("   ", "fallback_name")).toBe("fallback_name");
  });

  it("preserves Thai and Japanese Unicode characters in title", () => {
    expect(sanitizeExportFilename("ตอนที่_01_鬼滅の刃.png")).toBe("ตอนที่_01_鬼滅の刃.png");
  });
});

describe("generatePageFilename", () => {
  it("formats zero-padded page numbers with original basename and extension", () => {
    expect(generatePageFilename(0, "cover.jpg")).toBe("SuperK_Page_001_cover.jpg");
    expect(generatePageFilename(9, "page_10.png")).toBe("SuperK_Page_010_page_10.png");
    expect(generatePageFilename(99, "last_page.webp")).toBe("SuperK_Page_100_last_page.webp");
  });

  it("applies default extension when missing in original name", () => {
    expect(generatePageFilename(4, "raw_page", "png")).toBe("SuperK_Page_005_raw_page.png");
  });
});

describe("generateStripFilename", () => {
  it("returns single strip name when only 1 chunk", () => {
    expect(generateStripFilename(1, 1)).toBe("SuperK_Webtoon_LongStrip.jpg");
  });

  it("returns numbered strip part when multiple chunks", () => {
    expect(generateStripFilename(2, 4)).toBe("SuperK_Webtoon_Strip_Part02.jpg");
  });
});

describe("generateComicInfoXml", () => {
  it("generates valid ComicInfo XML with manga metadata and RTL direction", () => {
    const xml = generateComicInfoXml({
      title: "One Piece Ch.1000",
      pageCount: 20,
      languageISO: "th",
    });
    expect(xml).toContain("<Title>One Piece Ch.1000</Title>");
    expect(xml).toContain("<PageCount>20</PageCount>");
    expect(xml).toContain("<LanguageISO>th</LanguageISO>");
    expect(xml).toContain("<Manga>YesAndRightToLeft</Manga>");
  });
});
