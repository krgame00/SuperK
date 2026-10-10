import { sanitizeExportFilename } from "./exportManager";

export type PageExportSource = "translated" | "original" | "clean";
export interface ExportSourcePage { url: string; exportSource?: PageExportSource }
export function normalizePageExportSource(source: unknown): PageExportSource {
  return source === "original" || source === "clean" ? source : "translated";
}
/** Explicit sources never consult the translated cache or silently substitute an image. */
export async function resolvePageExportUrl(page: ExportSourcePage, cleanUrl: string | undefined,
  renderTranslated: () => Promise<string | null>): Promise<string> {
  const source = normalizePageExportSource(page.exportSource);
  if (source === "original") return page.url;
  if (source === "clean") {
    if (!cleanUrl) throw new Error("ไม่พบภาพคลีนสำหรับหน้านี้ กรุณาคลีนภาพก่อนส่งออก");
    return cleanUrl;
  }
  const rendered = await renderTranslated();
  if (!rendered) throw new Error("เรนเดอร์คำแปลไม่สำเร็จ");
  return rendered;
}
export async function exportImageBlob(url: string, fetcher: typeof fetch = fetch): Promise<Blob> {
  if (url.startsWith("data:")) {
    const separator = url.indexOf(",");
    if (separator < 0) throw new Error("ข้อมูลภาพไม่ถูกต้อง");
    const header = url.slice(0, separator);
    const mime = header.match(/^data:([^;,]+)/)?.[1] ?? "application/octet-stream";
    const payload = url.slice(separator + 1);
    const binary = /;base64$/i.test(header) ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }
  const response = await fetcher(url);
  if (!response.ok) throw new Error("โหลดภาพสำหรับส่งออกไม่สำเร็จ");
  const blob = await response.blob();
  if (!blob.size) throw new Error("ภาพสำหรับส่งออกไม่มีข้อมูล");
  return blob;
}
export function exportImageFilename(name: string, index: number, mime: string): string {
  const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg",
    "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg" };
  const extension = extensions[mime.toLowerCase().split(";")[0]];
  if (!extension) throw new Error(`ไม่รองรับชนิดภาพสำหรับส่งออก: ${mime || "unknown"}`);
  return `SuperK_Page_${String(index + 1).padStart(3, "0")}_${sanitizeExportFilename(name.replace(/\.[^/.]+$/, ""))}.${extension}`;
}
