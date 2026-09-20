/**
 * SuperK — Blob & File-Backed Page Storage (ADR 0013)
 *
 * Stores raw image Blobs outside the V8 JavaScript string heap.
 * Enables lazy decoding, fast Blob URL generation, and memory reclamation.
 */

export interface PageBlobEntry {
  id: string;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

export class PageBlobStoreClass {
  private blobs = new Map<string, PageBlobEntry>();
  private activeObjectUrls = new Map<string, string>();

  /**
   * Stores a page Blob and computes its byte size.
   */
  set(id: string, blob: Blob, mimeType?: string): PageBlobEntry {
    const sizeBytes = blob.size;
    const resolvedMime =
      mimeType ||
      (blob.type && blob.type !== "application/octet-stream"
        ? blob.type
        : "image/png");
    const typedBlob =
      blob.type === resolvedMime ? blob : new Blob([blob], { type: resolvedMime });
    const entry: PageBlobEntry = {
      id,
      blob: typedBlob,
      mimeType: resolvedMime,
      sizeBytes,
      createdAt: Date.now(),
    };
    this.blobs.set(id, entry);
    return entry;
  }

  /**
   * Retrieves the raw Blob for a page.
   */
  get(id: string): Blob | undefined {
    return this.blobs.get(id)?.blob;
  }

  getEntry(id: string): PageBlobEntry | undefined {
    return this.blobs.get(id);
  }

  has(id: string): boolean {
    return this.blobs.has(id);
  }

  /**
   * Obtains or creates an Object URL for the page Blob.
   */
  getOrCreateObjectUrl(id: string): string | null {
    const existing = this.activeObjectUrls.get(id);
    if (existing) return existing;

    const entry = this.blobs.get(id);
    if (!entry) return null;

    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      try {
        const url = URL.createObjectURL(entry.blob);
        this.activeObjectUrls.set(id, url);
        return url;
      } catch (err) {
        console.warn("Failed to create Object URL for page blob:", err);
      }
    }

    return null;
  }

  /**
   * Revokes the active Object URL to immediately free browser graphical RAM.
   */
  revokeObjectUrl(id: string): boolean {
    const url = this.activeObjectUrls.get(id);
    if (url) {
      if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
      this.activeObjectUrls.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Revokes all active Object URLs.
   */
  revokeAllObjectUrls(): void {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      for (const url of this.activeObjectUrls.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
    }
    this.activeObjectUrls.clear();
  }

  delete(id: string): boolean {
    this.revokeObjectUrl(id);
    return this.blobs.delete(id);
  }

  clear(): void {
    this.revokeAllObjectUrls();
    this.blobs.clear();
  }

  size(): number {
    return this.blobs.size;
  }

  getTotalSizeBytes(): number {
    let total = 0;
    for (const entry of this.blobs.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }
}

export const pageBlobStore = new PageBlobStoreClass();
