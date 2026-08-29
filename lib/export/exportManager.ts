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

export function generatePageFilename(
  index: number,
  originalName: string,
  defaultExtension = "png",
): string {
  const sanitizedName = sanitizeExportFilename(originalName);
  const dotIndex = sanitizedName.lastIndexOf(".");
  const extension =
    dotIndex !== -1 && dotIndex < sanitizedName.length - 1
      ? sanitizedName.substring(dotIndex + 1)
      : defaultExtension;
  const baseName =
    dotIndex !== -1 ? sanitizedName.substring(0, dotIndex) : sanitizedName;

  const pageNum = String(index + 1).padStart(3, "0");
  return `SuperK_Page_${pageNum}_${baseName}.${extension}`;
}

export interface WebtoonStripChunk {
  chunkIndex: number;
  totalChunks: number;
  filename: string;
}

export function generateStripFilename(
  chunkIndex: number,
  totalChunks: number,
): string {
  if (totalChunks <= 1) {
    return "SuperK_Webtoon_LongStrip.jpg";
  }
  return `SuperK_Webtoon_Strip_Part${String(chunkIndex).padStart(2, "0")}.jpg`;
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

export function generateComicInfoXml(meta: ComicInfoMetadata = {}): string {
  const title = meta.title || "Manga";
  const series = meta.series || title;
  const translator = meta.translator || "SuperK Manga Translator";
  const languageISO = meta.languageISO || "th";
  const pageCount = meta.pageCount || 1;

  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${title}</Title>
  <Series>${series}</Series>
  <Number>${meta.number || "1"}</Number>
  <Summary>${meta.summary || "Translated with SuperK Manga Translator"}</Summary>
  <Translator>${translator}</Translator>
  <PageCount>${pageCount}</PageCount>
  <LanguageISO>${languageISO}</LanguageISO>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>`;
}
