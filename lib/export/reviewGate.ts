import { normalizePageExportSource, type PageExportSource } from "./pageSource";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import { translationScope } from "@/lib/cleaning/textAuthorization";
import { findMissingTranslationRegions } from "@/lib/translation/completeness";
import { needsQualityReview } from "@/lib/translation/qualityReview";

export interface PageReviewInfo {
  pageIndex: number;
  pageUrl: string;
  pageName: string;
  hasUncertainCleaning: boolean;
  hasUncertainTranslation: boolean;
  missingTranslationCount: number;
  missingTranslationSignature: string;
  isConfirmed: boolean;
}

function missingRegions(cleaning?: PageCleaningResult | null, bubbles?: TranslatedBubble[] | null): number[][] {
  return cleaning ? findMissingTranslationRegions(bubbles ?? [], translationScope(cleaning)) : [];
}

function regionSignature(regions: number[][]): string {
  return JSON.stringify(regions.map(box => [...box]).sort((a, b) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]));
}

/** Snapshot omissions and unresolved semantic reviews so confirmation cannot accept new issues. */
export function missingTranslationSignature(
  cleaning?: PageCleaningResult | null,
  bubbles?: TranslatedBubble[] | null,
): string {
  const omissions = regionSignature(missingRegions(cleaning, bubbles));
  const quality = (bubbles ?? []).filter(needsQualityReview).map(b => ({
    box:b.box,source:b.original_text,text:b.t || b.translated,review:b.translationReview,
  }));
  return quality.length > 0 ? JSON.stringify({omissions,quality}) : omissions;
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
      needsQualityReview(b) ||
      (!b.deleted && (b.needsReview === true ||
      b.isLowConfidence === true ||
      (typeof b.confidence === "number" && b.confidence < 0.6))),
  );
}

/**
 * Evaluates whether a page requires human review confirmation before export.
 */
export function doesPageRequireReview(
  cleaningResult?: PageCleaningResult | null,
  bubbles?: TranslatedBubble[] | null,
): boolean {
  return isPageCleaningUncertain(cleaningResult) || isPageTranslationUncertain(bubbles) ||
    missingRegions(cleaningResult, bubbles).length > 0;
}

/**
 * Filters the list of pages to find any that require human confirmation but have not yet been confirmed.
 */
export function getUnconfirmedPages(
  pages: { url: string; name: string; exportSource?: PageExportSource }[],
  confirmedPages: Set<string>,
  cleaningResultsByPage: Map<string, PageCleaningResult>,
  bubblesByPage: Map<string, TranslatedBubble[]>,
  targetIndices?: number[],
  confirmedMissingTranslations?: Map<string, string>,
): PageReviewInfo[] {
  const indices = targetIndices ?? pages.map((_, i) => i);
  const unconfirmed: PageReviewInfo[] = [];

  for (const idx of indices) {
    const page = pages[idx];
    if (!page) continue;
    const source = normalizePageExportSource(page.exportSource);
    if (source === "original") continue;
    const cleaning = cleaningResultsByPage.get(page.url);
    const bubbles = source === "translated" ? bubblesByPage.get(page.url) : undefined;

    const hasUncertainCleaning = isPageCleaningUncertain(cleaning);
    const hasUncertainTranslation = isPageTranslationUncertain(bubbles);
    const missing = source === "translated" ? missingRegions(cleaning, bubbles) : [];
    const signature = source === "translated" ? missingTranslationSignature(cleaning, bubbles) : "clean";
    const hasSemanticReview = (bubbles ?? []).some(needsQualityReview);

    if (hasUncertainCleaning || hasUncertainTranslation || missing.length > 0) {
      const isConfirmed = confirmedPages.has(page.url) && ((missing.length === 0 && !hasSemanticReview) ||
        confirmedMissingTranslations?.get(page.url) === signature);
      if (!isConfirmed) {
        unconfirmed.push({
          pageIndex: idx,
          pageUrl: page.url,
          pageName: page.name || `Page ${idx + 1}`,
          hasUncertainCleaning,
          hasUncertainTranslation,
          missingTranslationCount: missing.length,
          missingTranslationSignature: signature,
          isConfirmed,
        });
      }
    }
  }

  return unconfirmed;
}
