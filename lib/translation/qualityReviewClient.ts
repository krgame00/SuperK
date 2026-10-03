import type { TranslatedBubble } from "@/lib/translationOverlay";
import { MAX_REVIEW_ITEMS, MAX_REVIEW_TEXT_LENGTH, parseQualityReviews, unavailableReview, type QualityReviewItem } from "./qualityReview";

interface ReviewOptions {
  targetLang: string;
  apiKey?: string;
  modelPreference?: string;
  allowPreview?: boolean;
  glossary?: unknown[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** A failed checker must not discard an otherwise successful translation. */
export async function reviewTranslatedBubbles(bubbles: TranslatedBubble[], options: ReviewOptions): Promise<TranslatedBubble[]> {
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const items: QualityReviewItem[] = [];
  const result = bubbles.map((bubble, index) => {
    if (bubble.deleted || bubble.isManual || !(bubble.t || bubble.translated || "").trim()) return bubble;
    const item = {id:String(index),sourceText:typeof bubble.original_text === "string" ? bubble.original_text.trim() : "",translatedText:(bubble.t || bubble.translated || "").trim()};
    const eligible = item.sourceText.length > 0 && item.sourceText.length <= MAX_REVIEW_TEXT_LENGTH &&
      item.translatedText.length <= MAX_REVIEW_TEXT_LENGTH && items.length < MAX_REVIEW_ITEMS;
    if (eligible) items.push(item);
    return {...bubble,translationReview:unavailableReview(item, eligible ? undefined :
      !item.sourceText ? "ไม่มีข้อความต้นฉบับให้เทียบ กรุณาตรวจจากภาพ" : "ข้อความเกินขอบเขตการตรวจ กรุณาตรวจจากภาพ")};
  });
  if (items.length === 0) return result;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, {once:true});
  const timeout = setTimeout(cancel, 50_000);
  try {
    const response = await (options.fetchImpl ?? fetch)("/api/translation-review", {
      method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,
      body:JSON.stringify({items,targetLang:options.targetLang,apiKey:options.apiKey,
        modelPreference:options.modelPreference,allowPreview:options.allowPreview,glossary:options.glossary ?? []}),
    });
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (!response.ok) return result;
    const reviews = parseQualityReviews(items, await response.json());
    for (const item of items) result[Number(item.id)].translationReview = reviews[item.id];
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return result;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    // Request timeout, network failure and malformed JSON all leave explicit unavailable snapshots.
    void error;
    return result;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort",cancel);
  }
}
