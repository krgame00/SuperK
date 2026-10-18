import { sanitizeExportFilename } from "./exportManager";

export type PageExportSource = "translated" | "original" | "clean";
export type ExportImageFormat = "jpg" | "png" | "webp" | "auto";
export interface ExportSourcePage { url: string; exportSource?: PageExportSource }

export function normalizePageExportSource(source: unknown): PageExportSource {
  return source === "original" || source === "clean" ? source : "translated";
}

export function normalizeExportImageFormat(format: unknown): ExportImageFormat {
  return format === "png" || format === "webp" || format === "auto" || format === "jpg"
    ? format
    : "jpg";
}

export function exportFormatToMime(format: ExportImageFormat): string | undefined {
  if (format === "jpg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return undefined;
}

/** Explicit sources never consult the translated cache or silently substitute an image. */
export async function resolvePageExportUrl(
  page: ExportSourcePage,
  cleanUrl: string | undefined,
  renderTranslated: () => Promise<string | null>,
): Promise<string> {
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

/**
 * Converts an exported page Blob to a unified image MIME type (image/jpeg, image/png, or image/webp)
 * so all exported pages in a chapter share the exact same file extension.
 */
export async function convertExportBlobToFormat(
  blob: Blob,
  format: ExportImageFormat,
  forceWhenUndecodable = false,
): Promise<Blob> {
  if (format === "auto") return blob;
  const targetMime = exportFormatToMime(format);
  if (!targetMime) return blob;
  const currentMime = blob.type.toLowerCase().split(";")[0];
  if (currentMime === targetMime) return blob;

  const isJsdom =
    typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");

  if (!isJsdom && typeof document !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const decoded = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => resolve(null), 2000);
        img.onload = () => {
          clearTimeout(timer);
          resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null);
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        img.src = objectUrl;
      });

      if (decoded) {
        const canvas = document.createElement("canvas");
        canvas.width = decoded.naturalWidth;
        canvas.height = decoded.naturalHeight;
        try {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            if (targetMime === "image/jpeg") {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.drawImage(decoded, 0, 0);
            const quality = targetMime === "image/png" ? undefined : 0.92;
            if (typeof canvas.toBlob === "function") {
              const converted = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob((res) => resolve(res), targetMime, quality);
              });
              if (converted && converted.size > 0) {
                return converted;
              }
            }
            const dataUrl = canvas.toDataURL(targetMime, quality);
            if (dataUrl.startsWith(`data:${targetMime}`)) {
              return await exportImageBlob(dataUrl);
            }
          }
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    } catch {
      // Fall through to fallback below
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (forceWhenUndecodable) {
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      if (typeof blob.arrayBuffer === "function") {
        blob.arrayBuffer().then(resolve, reject);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    return new Blob([buffer], { type: targetMime });
  }

  return blob;
}

export function exportImageFilename(name: string, index: number, mime: string): string {
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
  };
  const extension = extensions[mime.toLowerCase().split(";")[0]];
  if (!extension) throw new Error(`ไม่รองรับชนิดภาพสำหรับส่งออก: ${mime || "unknown"}`);
  return `SuperK_Page_${String(index + 1).padStart(3, "0")}_${sanitizeExportFilename(name.replace(/\.[^/.]+$/, ""))}.${extension}`;
}
