import { describe, expect, it } from "vitest";

import {
  deriveProjectExportName,
  escapeXml,
  generateArchiveFilename,
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

describe("deriveProjectExportName & generateArchiveFilename", () => {
  it("extracts series/title from first page filename", () => {
    expect(deriveProjectExportName([{ name: "OnePiece_Ch1000_01.jpg" }])).toBe(
      "SuperK_OnePiece_Ch1000",
    );
    expect(deriveProjectExportName([{ name: "Dandadan-Vol02-Page05.png" }])).toBe(
      "SuperK_Dandadan-Vol02",
    );
    expect(deriveProjectExportName([{ name: "Naruto_Chapter_5_page1.jpg" }])).toBe(
      "SuperK_Naruto_Chapter_5",
    );
  });

  it("preserves names that already have SuperK prefix", () => {
    expect(deriveProjectExportName([{ name: "SuperK_Page_001_MyStory.png" }])).toBe(
      "SuperK_MyStory",
    );
  });

  it("falls back to SuperK_Translations for generic or numbered-only pages", () => {
    expect(deriveProjectExportName([])).toBe("SuperK_Translations");
    expect(deriveProjectExportName([{ name: "001.png" }, { name: "002.png" }])).toBe(
      "SuperK_Translations",
    );
    expect(deriveProjectExportName([{ name: "page_1.jpg" }])).toBe("SuperK_Translations");
    expect(deriveProjectExportName([{ name: "image.webp" }])).toBe("SuperK_Translations");
  });

  it("generates archive filenames matching format", () => {
    expect(generateArchiveFilename("zip", [{ name: "Bleach_Ch01_01.jpg" }])).toBe(
      "SuperK_Bleach_Ch01.zip",
    );
    expect(generateArchiveFilename("cbz", [{ name: "Bleach_Ch01_01.jpg" }])).toBe(
      "SuperK_Bleach_Ch01.cbz",
    );
    expect(generateArchiveFilename("pdf", [{ name: "Bleach_Ch01_01.jpg" }])).toBe(
      "SuperK_Bleach_Ch01.pdf",
    );
    expect(generateArchiveFilename("zip")).toBe("SuperK_Translations.zip");
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

  it("uses custom manga project name when pages are supplied", () => {
    expect(
      generateStripFilename(1, 1, [{ name: "OnePiece_100_01.jpg" }]),
    ).toBe("SuperK_OnePiece_100_LongStrip.jpg");
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

describe("escapeXml", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`Tom & Jerry <1> "x" 'y'`)).toBe(
      "Tom &amp; Jerry &lt;1&gt; &quot;x&quot; &apos;y&apos;",
    );
  });
});

describe("generateComicInfoXml escaping", () => {
  it("produces valid XML even when title contains XML special characters", () => {
    const xml = generateComicInfoXml({
      title: `Tom & Jerry <โจร>"ตอนจบ"`,
      pageCount: 3,
      languageISO: "th",
    });
    expect(xml).toContain("<Title>Tom &amp; Jerry &lt;โจร&gt;&quot;ตอนจบ&quot;</Title>");
    expect(xml).not.toContain("<Title>Tom & Jerry");
    // Round-trips back to the original title when parsed
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    expect(parsed.querySelector("Title")?.textContent).toBe(
      `Tom & Jerry <โจร>"ตอนจบ"`,
    );
    expect(parsed.querySelector("parsererror")).toBeNull();
  });

  it("escapes series, number, summary and translator too", () => {
    const xml = generateComicInfoXml({
      title: "ok",
      series: "S & S",
      number: "1<2",
      summary: "a > b",
      translator: "N'CMS",
    });
    expect(xml).toContain("<Series>S &amp; S</Series>");
    expect(xml).toContain("<Number>1&lt;2</Number>");
    expect(xml).toContain("<Summary>a &gt; b</Summary>");
    expect(xml).toContain("<Translator>N&apos;CMS</Translator>");
  });
});
