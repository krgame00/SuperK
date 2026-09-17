/**
 * SuperK — Session Processed-Page Spill & Revision-Safe Restore (ADR 0013)
 *
 * Temporarily spills evicted in-memory processed-page results to session storage,
 * and restores them quickly if revisited, provided the revision signature matches exactly.
 */

export interface SpillCacheEntry<T = unknown> {
  pageUrl: string;
  signature: string;
  createdAt: number;
  data: T;
}

export class SessionProcessedPageSpillCache<T = unknown> {
  private entries = new Map<string, SpillCacheEntry<T>>();

  /**
   * Spills an evicted processed page entry into the session cache.
   */
  spill(pageUrl: string, signature: string, data: T): void {
    this.entries.set(pageUrl, {
      pageUrl,
      signature,
      createdAt: Date.now(),
      data,
    });
  }

  /**
   * Attempts to restore an evicted processed page if signature matches.
   * Returns null if not found or if signature is stale.
   */
  restore(pageUrl: string, expectedSignature: string): T | null {
    const entry = this.entries.get(pageUrl);
    if (!entry) return null;

    if (entry.signature !== expectedSignature) {
      // Signature mismatch -> stale revision, purge entry safely
      this.entries.delete(pageUrl);
      return null;
    }

    return entry.data;
  }

  has(pageUrl: string): boolean {
    return this.entries.has(pageUrl);
  }

  invalidate(pageUrl: string): boolean {
    return this.entries.delete(pageUrl);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
