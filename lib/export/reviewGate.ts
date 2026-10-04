import { normalizePageExportSource, type PageExportSource } from "./pageSource";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import { translationScope } from "@/lib/cleaning/textAuthorization";
import { backgroundEligibilityState, type BackgroundInspectionResult } from "@/lib/cleaning/backgroundRemnantInspection";
import { findMissingTranslationRegions } from "@/lib/translation/completeness";
import { needsQualityReview, isReviewCurrent } from "@/lib/translation/qualityReview";
import { LANGUAGE_POLICY_VERSION } from "@/lib/languagePolicy";
import { inspectPageOutputEligibility, type PageTargetIdentity } from "@/lib/translation/pageEligibility";

export interface PageReviewInfo {
  pageIndex: number;
  pageUrl: string;
  pageName: string;
  hasUncertainCleaning: boolean;
  hasUncertainTranslation: boolean;
  missingTranslationCount: number;
  missingTranslationSignature: string;
  isConfirmed: boolean;
  /** Deterministic excluded-script failures. Never confirmable — repair the text. */
  scriptIssueCount: number;
  /** Points whose review evidence is absent, stale or unresolved. Needs explicit per-point confirmation. */
  unverifiedReviewCount: number;
  /** Translated page without a confirmed target identity. */
  targetUnconfirmed: boolean;
  /** Background-remnant finding (R01 boundary), decoupled from generated-text approval. */
  backgroundBlocked: boolean;
  /** True when at least one blocker above exists: page confirmation can never clear these. */
  hasHardBlockers: boolean;
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
 * Checks if a page requires human review confirmation before export.
 */
export function doesPageRequireReview(
  cleaningResult?: PageCleaningResult | null,
  bubbles?: TranslatedBubble[] | null,
): boolean {
  return isPageCleaningUncertain(cleaningResult) || isPageTranslationUncertain(bubbles) ||
    missingRegions(cleaningResult, bubbles).length > 0;
}

export interface PageOutputBlockers {
  targetUnconfirmed: boolean;
  scriptIssueCount: number;
  unverifiedReviewCount: number;
  backgroundBlocked: boolean;
}

/**
 * The shared output-eligibility rule, recomputed locally from raw text at every
 * output boundary. Existing approvals never bypass this result:
 * - deterministic script failures are re-detected from the raw lettering, so old
 *   accepted/dismissed states and page confirmations cannot bypass them;
 * - points with absent/stale/unresolved review evidence (legacy and manual
 *   points included) stay unresolved until explicit per-point confirmation;
 * - a translated page without a confirmed target identity is blocked;
 * - a background-remnant inspection result (lib/cleaning/backgroundRemnantInspection)
 *   feeds the same boundary and is never resolved by generated-text approval.
 */
export function getPageOutputBlockers(
  bubbles?: TranslatedBubble[] | null,
  targetIdentity?: PageTargetIdentity | string,
  backgroundInspection?: BackgroundInspectionResult,
  sourceRevision?: string,
): PageOutputBlockers {
  const identity = typeof targetIdentity === "string" ? undefined : targetIdentity;
  const targetId = identity?.targetId;
  const active = (bubbles ?? []).filter(
    (bubble) => !bubble.deleted && (bubble.t || bubble.translated || "").length > 0,
  );
  const backgroundState = backgroundInspection ? backgroundEligibilityState(backgroundInspection) : undefined;
  const blockers: PageOutputBlockers = {
    // Without a confirmed target no per-point check means anything yet.
    targetUnconfirmed: active.length > 0 && (!identity || identity.policyVersion !== LANGUAGE_POLICY_VERSION),
    scriptIssueCount: 0,
    unverifiedReviewCount: 0,
    backgroundBlocked: !backgroundState || backgroundState === "unresolved" || backgroundState === "unavailable",
  };
  if (!targetId || active.length === 0) return blockers;
  const eligibility = inspectPageOutputEligibility({
    targetIdentity: identity,
    points: active.map((bubble, pointIndex) => ({
      id: String(pointIndex),
      text: bubble.t || bubble.translated || "",
      sourceText: typeof bubble.original_text === "string" ? bubble.original_text : undefined,
    })),
    // Contextual review is enforced per point below; background evidence is
    // required whenever an inspection result was produced for the page.
    requirements: { contextual: false, background: backgroundInspection !== undefined },
    ...(backgroundState ? { backgroundState } : {}),
  });
  blockers.targetUnconfirmed ||= eligibility.reasons.some(reason => ["target-unconfirmed", "unsupported-target", "policy-changed"].includes(reason));
  blockers.scriptIssueCount = eligibility.pointIssues.length;
  blockers.unverifiedReviewCount = active.filter((bubble) => {
    const review = bubble.translationReview;
    // Stable original-image identity is distinct from edit-bumped page revisions.
    // Old or unbound evidence requires an explicit review against the current source.
    return !sourceRevision || !review || review.policyVersion !== LANGUAGE_POLICY_VERSION || !isReviewCurrent(bubble, targetId, sourceRevision) ||
      !["ok", "accepted", "dismissed"].includes(review.status);
  }).length;
  return blockers;
}

export interface PageEligibilityGateOptions {
  /** Legacy target IDs never provide policy evidence; retained for old callers to fail closed. */
  targetIds?: Map<string, string | undefined>;
  targetIdentities?: Map<string, PageTargetIdentity | undefined>;
  sourceRevisions?: Map<string, string | undefined>;
  /** Background-remnant inspection per page URL, produced by the R01 evidence pipeline. */
  backgroundInspections?: Map<string, BackgroundInspectionResult>;
}

/**
 * Filters the list of pages to find any that require human confirmation but have not yet been confirmed.
 *
 * Omission and low-confidence warnings are confirmable through the bound
 * omission signature; deterministic script failures, unresolved review evidence,
 * unconfirmed targets and background-remnant findings (`hasHardBlockers`) are
 * listed until repaired, explicitly substituted with the original image
 * (`exportSource: "original"`) or explicitly excluded (`exportExcluded`).
 */
export function getUnconfirmedPages(
  pages: { url: string; name: string; exportSource?: PageExportSource; exportExcluded?: boolean }[],
  confirmedPages: Set<string>,
  cleaningResultsByPage: Map<string, PageCleaningResult>,
  bubblesByPage: Map<string, TranslatedBubble[]>,
  targetIndices?: number[],
  confirmedMissingTranslations?: Map<string, string>,
  options?: PageEligibilityGateOptions,
): PageReviewInfo[] {
  const indices = targetIndices ?? pages.map((_, i) => i);
  const unconfirmed: PageReviewInfo[] = [];

  for (const idx of indices) {
    const page = pages[idx];
    if (!page) continue;
    // An explicitly excluded page is not silently omitted: the export reports it.
    if (page.exportExcluded) continue;
    const source = normalizePageExportSource(page.exportSource);
    if (source === "original") continue;
    const cleaning = cleaningResultsByPage.get(page.url);
    const bubbles = source === "translated" ? bubblesByPage.get(page.url) : undefined;

    const blockers = getPageOutputBlockers(
      bubbles,
      options?.targetIdentities?.get(page.url),
      options?.backgroundInspections?.get(page.url),
      options?.sourceRevisions?.get(page.url),
    );
    blockers.backgroundBlocked ||= !cleaning?.cleanUrl;
    const hasHardBlockers = blockers.targetUnconfirmed || blockers.scriptIssueCount > 0 ||
      blockers.unverifiedReviewCount > 0 || blockers.backgroundBlocked;

    const hasUncertainCleaning = isPageCleaningUncertain(cleaning);
    const hasUncertainTranslation = isPageTranslationUncertain(bubbles);
    const missing = source === "translated" ? missingRegions(cleaning, bubbles) : [];
    const signature = source === "translated" ? missingTranslationSignature(cleaning, bubbles) : "clean";
    const hasSemanticReview = (bubbles ?? []).some(needsQualityReview);

    if (hasHardBlockers || hasUncertainCleaning || hasUncertainTranslation || missing.length > 0) {
      // Hard blockers can never be confirmed away; the signature-bound
      // confirmation only covers omissions and low-confidence warnings.
      const isConfirmed = !hasHardBlockers && confirmedPages.has(page.url) && ((missing.length === 0 && !hasSemanticReview) ||
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
          scriptIssueCount: blockers.scriptIssueCount,
          unverifiedReviewCount: blockers.unverifiedReviewCount,
          targetUnconfirmed: blockers.targetUnconfirmed,
          backgroundBlocked: blockers.backgroundBlocked,
          hasHardBlockers,
        });
      }
    }
  }

  return unconfirmed;
}
