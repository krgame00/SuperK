/**
 * SuperK — Balanced Page Resource Lifecycle & Warm Navigation Set (ADR 0013)
 *
 * Replaces whole-book eager full-resolution source residency with lazy access
 * while keeping the current page, previous page, and next page responsive.
 */

export interface PageLifecycleState {
  currentPage: number;
  totalPages: number;
  warmIndices: number[];
}

/**
 * Returns the set of warm page indices (current, previous 1, next 1).
 */
export function getWarmPageIndices(
  currentPage: number,
  totalPages: number,
): number[] {
  if (totalPages <= 0) return [];
  const indices: number[] = [];
  const prev = currentPage - 1;
  const curr = currentPage;
  const next = currentPage + 1;

  if (prev >= 0 && prev < totalPages) indices.push(prev);
  if (curr >= 0 && curr < totalPages && !indices.includes(curr)) indices.push(curr);
  if (next >= 0 && next < totalPages && !indices.includes(next)) indices.push(next);

  return indices.sort((a, b) => a - b);
}

/**
 * Checks if a specific page index is within the active warm navigation set.
 */
export function isPageInWarmSet(
  pageIndex: number,
  currentPage: number,
  totalPages: number,
): boolean {
  const warm = getWarmPageIndices(currentPage, totalPages);
  return warm.includes(pageIndex);
}

/**
 * Filter a map/cache of page resources, retaining warm pages and evicting cold entries.
 * Returns the retained map and the list of evicted keys.
 */
export function reconcileWarmPageCache<T>(
  cache: Map<string, T>,
  pageUrls: string[],
  currentPage: number,
  onEvict?: (url: string, item: T) => void,
): { retained: Map<string, T>; evictedUrls: string[] } {
  const warmIndices = new Set(getWarmPageIndices(currentPage, pageUrls.length));
  const warmUrls = new Set(
    Array.from(warmIndices)
      .map((idx) => pageUrls[idx])
      .filter((url): url is string => Boolean(url)),
  );

  const retained = new Map<string, T>();
  const evictedUrls: string[] = [];

  for (const [url, item] of cache.entries()) {
    if (warmUrls.has(url)) {
      retained.set(url, item);
    } else {
      evictedUrls.push(url);
      if (onEvict) {
        onEvict(url, item);
      }
    }
  }

  return { retained, evictedUrls };
}
