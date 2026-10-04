import type { TranslatedBubble } from "@/lib/translationOverlay";
import { inspectTargetText } from "@/lib/languagePolicy";
import { guardQualityReview, MAX_REVIEW_ITEMS, MAX_REVIEW_TEXT_LENGTH, parseQualityReviews, unavailableReview, withReviewIdentity, type QualityReviewItem, type TranslationReview } from "./qualityReview";

interface ReviewOptions {
  targetLang: string;
  apiKey?: string;
  modelPreference?: string;
  allowPreview?: boolean;
  glossary?: unknown[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Exact source evidence revision bound into every recorded snapshot. */
  sourceRevision?: string;
  /** Run the single bounded automatic repair round for locally detected script contamination. */
  repairContamination?: boolean;
}

class ReviewRequestFailed extends Error {}

function chunkItems(items: QualityReviewItem[]): QualityReviewItem[][] {
  const chunks: QualityReviewItem[][] = [];
  for (let index = 0; index < items.length; index += MAX_REVIEW_ITEMS) chunks.push(items.slice(index, index + MAX_REVIEW_ITEMS));
  return chunks;
}

/**
 * A failed checker must not discard an otherwise successful translation.
 * Every active (non-deleted) point ends with an explicit snapshot: provider
 * reviewed, or locally marked unavailable. Deleted points never participate.
 */
export async function reviewTranslatedBubbles(bubbles: TranslatedBubble[], options: ReviewOptions): Promise<TranslatedBubble[]> {
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const result = bubbles.slice();
  const entries = bubbles.flatMap((bubble, index) => {
    if (bubble.deleted) return [];
    // Exact raw text is preserved end-to-end (snapshots and request payloads);
    // only the provider suggestion is trimmed before equivalence checks.
    const sourceText = typeof bubble.original_text === "string" ? bubble.original_text : "";
    const translatedText = bubble.t || bubble.translated || "";
    const item: QualityReviewItem = {id:String(index),sourceText,translatedText};
    const reviewable = !!sourceText.trim() && !!translatedText.trim() &&
      sourceText.length <= MAX_REVIEW_TEXT_LENGTH && translatedText.length <= MAX_REVIEW_TEXT_LENGTH;
    result[index] = {...bubble,translationReview:guardQualityReview(withReviewIdentity(
      unavailableReview(item, !sourceText.trim() ? "ไม่มีข้อความต้นฉบับให้เทียบ กรุณาตรวจจากภาพ" : "ข้อความเกินขอบเขตการตรวจ กรุณาตรวจจากภาพ"),
      options.targetLang,options.sourceRevision),options.targetLang)};
    return [{index,item,reviewable}];
  });
  const items = entries.filter(entry => entry.reviewable).map(entry => entry.item);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, {once:true});
  const requestChunk = async (chunk: QualityReviewItem[], mode?: "repair"): Promise<Record<string, TranslationReview>> => {
    const timeout = setTimeout(cancel, 50_000);
    try {
      const response = await (options.fetchImpl ?? fetch)("/api/translation-review", {
        method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,
        body:JSON.stringify({items:chunk,targetLang:options.targetLang,apiKey:options.apiKey,
          modelPreference:options.modelPreference,allowPreview:options.allowPreview,
          glossary:options.glossary ?? [],...(mode ? {mode}:{})}),
      });
      if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (!response.ok) throw new ReviewRequestFailed(String(response.status));
      return parseQualityReviews(chunk, await response.json(), options.targetLang, options.sourceRevision);
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    // Dense pages exceed single-request limits: chunk instead of silently
    // leaving active points unreviewed. A failed chunk keeps its explicit
    // unavailable snapshot; cancellation still propagates to the caller.
    for (const chunk of chunkItems(items)) {
      const reviews = await requestChunk(chunk);
      if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      for (const item of chunk) {
        const index = Number(item.id);
        result[index] = {...result[index],translationReview:reviews[item.id]};
      }
    }
    if (options.repairContamination) {
      // The one logical automatic repair round per page/run: only locally
      // detected script contamination, only affected point IDs, validated once,
      // and never stacked with a whole-image retry. Editorial (clean) review
      // suggestions stay explicit-acceptance and are never applied here.
      const affected = entries
        .filter(entry => entry.reviewable && inspectTargetText(entry.item.translatedText, options.targetLang).status === "blocked")
        .map(entry => entry.item);
      for (const chunk of chunkItems(affected)) {
        if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        let reviews: Record<string, TranslationReview>;
        try {
          reviews = await requestChunk(chunk, "repair");
        } catch (error) {
          if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          void error;
          break; // A failed repair keeps the unresolved review snapshot; no loop.
        }
        if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        for (const item of chunk) {
          const review = reviews[item.id];
          // Missing/duplicate/malformed repair rows and provider "ok" without a
          // replacement never resolve the point; the review snapshot stands.
          if (review?.status !== "suggested" || review.suggestion === undefined) continue;
          const replacement = review.suggestion;
          const index = Number(item.id);
          // The suggestion was validated once against the target policy in
          // parseQualityReviews; contaminated repairs never reach this branch.
          result[index] = {...result[index],t:replacement,translated:replacement,
            translationReview:withReviewIdentity({status:"ok",sourceText:item.sourceText,
              reviewedText:replacement,originalTranslation:item.translatedText},
              options.targetLang,options.sourceRevision)};
        }
      }
    }
    return result;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    // Request timeout, network failure and malformed JSON all leave explicit unavailable snapshots.
    void error;
    return result;
  } finally {
    options.signal?.removeEventListener("abort",cancel);
  }
}
