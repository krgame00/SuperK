import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { TranslatedBubble } from "@/lib/translationOverlay";

export interface PageReviewInfo {
  pageIndex: number;
  pageUrl: string;
  pageName: string;
  hasUncertainCleaning: boolean;
  hasUncertainTranslation: boolean;
  isConfirmed: boolean;
}

/**
 * Checks if a page has uncertain cleaning (regions with needs_review or review text role).
 */
export function isPageCleaningUncertain(
  cleaningResult?: PageCleaningResult | null,
): boolean {
  if (!cleaningResult || !Array.isArray(cleaningResult.regions)) return false;
  return cleaningResult.regions.some(
    (r) =>
      r.status === "needs_review" ||
      r.textRole === "review" ||
      r.protectionReasons?.includes("low-confidence") ||
      (typeof r.confidence === "number" && r.confidence < 0.6),
  );
}

/**
 * Checks if a page has uncertain translation (bubbles flagged as low-confidence or needs_review).
 */
export function isPageTranslationUncertain(
  bubbles?: TranslatedBubble[] | null,
): boolean {
  if (!bubbles || !Array.isArray(bubbles)) return false;
  return bubbles.some(
    (b) =>
      b.needsReview === true ||
      b.isLowConfidence === true ||
      (typeof b.confidence === "number" && b.confidence < 0.6),
  );
}

/**
 * Evaluates whether a page requires human review confirmation before export.
 */
export function doesPageRequireReview(
  cleaningResult?: PageCleaningResult | null,
  bubbles?: TranslatedBubble[] | null,
): boolean {
  return isPageCleaningUncertain(cleaningResult) || isPageTranslationUncertain(bubbles);
}

/**
 * Filters the list of pages to find any that require human confirmation but have not yet been confirmed.
 */
export function getUnconfirmedPages(
  pages: { url: string; name: string }[],
  confirmedPages: Set<string>,
  cleaningResultsByPage: Map<string, PageCleaningResult>,
  bubblesByPage: Map<string, TranslatedBubble[]>,
  targetIndices?: number[],
): PageReviewInfo[] {
  const indices = targetIndices ?? pages.map((_, i) => i);
  const unconfirmed: PageReviewInfo[] = [];

  for (const idx of indices) {
    const page = pages[idx];
    if (!page) continue;
    const cleaning = cleaningResultsByPage.get(page.url);
    const bubbles = bubblesByPage.get(page.url);

    const hasUncertainCleaning = isPageCleaningUncertain(cleaning);
    const hasUncertainTranslation = isPageTranslationUncertain(bubbles);

    if (hasUncertainCleaning || hasUncertainTranslation) {
      const isConfirmed = confirmedPages.has(page.url);
      if (!isConfirmed) {
        unconfirmed.push({
          pageIndex: idx,
          pageUrl: page.url,
          pageName: page.name || `Page ${idx + 1}`,
          hasUncertainCleaning,
          hasUncertainTranslation,
          isConfirmed,
        });
      }
    }
  }

  return unconfirmed;
}
