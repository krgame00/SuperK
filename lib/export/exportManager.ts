// Export helpers and sanitization utilities for SuperK Manga Translator

export function sanitizeExportFilename(
  name: string,
  fallback = "manga_page",
): string {
  if (!name || typeof name !== "string") return fallback;
  // Replace illegal filename characters across Windows/POSIX: \ / : * ? " < > |
  const sanitized = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.length > 0 ? sanitized : fallback;
}

export interface WebtoonStripChunk {
  chunkIndex: number;
  totalChunks: number;
  filename: string;
}

export function deriveProjectExportName(
  pages?: Array<{ name?: string }>,
  fallback = "SuperK_Translations",
): string {
  if (!pages || pages.length === 0 || !pages[0]?.name) {
    return fallback;
  }

  const raw = pages[0].name.replace(/\.[^/.]+$/, "").trim();
  if (!raw) return fallback;

  // If already prefixed with SuperK_Page_001_Title:
  let cleaned = raw.replace(/^SuperK_Page_\d+_/i, "").trim();

  // Strip trailing page numbering patterns:
  // e.g. _page1, -page01, _p1, -p01, _001, -01, (1), etc.
  cleaned = cleaned
    .replace(/([_\s-]*(?:page|p)?\s*\d+)$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .trim();

  const lower = cleaned.toLowerCase();
  if (
    !cleaned ||
    /^\d+$/.test(cleaned) ||
    lower === "page" ||
    lower === "image" ||
    lower === "img" ||
    lower === "scan" ||
    lower === "raw" ||
    lower === "manga" ||
    lower === "manga_page"
  ) {
    return fallback;
  }

  const sanitized = sanitizeExportFilename(cleaned);
  if (!sanitized || sanitized === "manga_page") {
    return fallback;
  }

  return sanitized.startsWith("SuperK_") ? sanitized : `SuperK_${sanitized}`;
}

export function generateArchiveFilename(
  format: "zip" | "cbz" | "pdf",
  pages?: Array<{ name?: string }>,
): string {
  const baseName = deriveProjectExportName(pages);
  return `${baseName}.${format}`;
}

export function generateStripFilename(
  chunkIndex: number,
  totalChunks: number,
  pages?: Array<{ name?: string }>,
): string {
  const baseName = deriveProjectExportName(pages, "SuperK_Webtoon");
  if (totalChunks <= 1) {
    return `${baseName}_LongStrip.jpg`;
  }
  return `${baseName}_Strip_Part${String(chunkIndex).padStart(2, "0")}.jpg`;
}

export interface ComicInfoMetadata {
  title?: string;
  series?: string;
  number?: string;
  summary?: string;
  writer?: string;
  penciller?: string;
  translator?: string;
  pageCount?: number;
  languageISO?: string;
}

/** Escapes XML special characters so metadata from filenames (e.g. "Tom &
 *  Jerry") can't produce invalid ComicInfo.xml that breaks CBZ readers. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateComicInfoXml(meta: ComicInfoMetadata = {}): string {
  const title = escapeXml(meta.title || "Manga");
  const series = escapeXml(meta.series || meta.title || "Manga");
  const translator = escapeXml(meta.translator || "SuperK Manga Translator");
  const languageISO = escapeXml(meta.languageISO || "th");
  const number = escapeXml(meta.number || "1");
  const summary = escapeXml(
    meta.summary || "Translated with SuperK Manga Translator",
  );
  const pageCount = meta.pageCount || 1;

  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${title}</Title>
  <Series>${series}</Series>
  <Number>${number}</Number>
  <Summary>${summary}</Summary>
  <Translator>${translator}</Translator>
  <PageCount>${pageCount}</PageCount>
  <LanguageISO>${languageISO}</LanguageISO>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>`;
}

export function generatePhotoshopBuildScript(
  pageNumber: number,
  origFilename: string,
  cleanFilename: string,
  bubbles: Array<{
    t?: string;
    translated?: string;
    original_text?: string;
    box?: number[];
    deleted?: boolean;
  }>,
): string {
  const safeBubbles = bubbles
    .map((b, i) => ({
      index: i + 1,
      deleted: Boolean(b.deleted || (b as { hidden?: boolean }).hidden),
      text: String(b.t ?? b.translated ?? "").replace(/\r?\n/g, " "),
      orig: String(b.original_text ?? "").replace(/\r?\n/g, " "),
      box: Array.isArray(b.box) && b.box.length === 4 ? b.box : [100, 100, 200, 300],
    }))
    .filter((b) => !b.deleted);
  return `// SuperK Layered PSD Builder Script for Page ${pageNumber}
// Run in Adobe Photoshop or Photopea via File -> Scripts -> Browse...
#target photoshop
(function() {
  var folder = File($.fileName).parent;
  var origFile = File(folder + "/${origFilename}");
  var cleanFile = File(folder + "/${cleanFilename}");
  if (!origFile.exists) { alert("Missing " + origFile.fsName); return; }
  var doc = app.open(origFile);
  doc.activeLayer.name = "Original Raw";
  if (cleanFile.exists) {
    var cleanDoc = app.open(cleanFile);
    cleanDoc.activeLayer.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
    cleanDoc.close(SaveOptions.DONOTSAVECHANGES);
    doc.activeLayer.name = "Inpainted Clean";
  }
  var textGroup = doc.layerSets.add();
  textGroup.name = "Translated Text Layers";
  var bubbles = ${JSON.stringify(safeBubbles)};
  var w = doc.width.as("px");
  var h = doc.height.as("px");
  for (var i = 0; i < bubbles.length; i++) {
    var b = bubbles[i];
    if (!b.text) continue;
    var tl = textGroup.artLayers.add();
    tl.kind = LayerKind.TEXT;
    tl.name = "#" + b.index + " " + b.text.substring(0, 20);
    var ti = tl.textItem;
    ti.contents = b.text;
    ti.justification = Justification.CENTER;
    var cx = ((b.box[1] + b.box[3]) / 2000) * w;
    var cy = ((b.box[0] + b.box[2]) / 2000) * h;
    ti.position = [UnitValue(cx, "px"), UnitValue(cy, "px")];
  }
})();
`;
}
