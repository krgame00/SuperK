import { NextResponse } from "next/server";
import { GeminiRequestError, requestOpenAICompatible, throwIfRequestAborted, withGeminiDeadline } from "@/lib/server/geminiRequest";
import { GeminiRoutingError } from "@/lib/server/geminiCatalog";
import { executeGeminiTranslation, geminiRoutingHttpStatus } from "@/lib/server/geminiTranslationRouter";
import { guardQualityReview, buildQualityReviewPrompt, MAX_REVIEW_ITEMS, MAX_REVIEW_TEXT_LENGTH, type QualityReviewItem } from "@/lib/translation/qualityReview";
import type { GlossaryEntry } from "@/lib/translation/glossary";

const MAX_BODY_BYTES = 1024 * 1024;
const REVIEW_BUDGET_MS = 45_000;
interface ReviewRequest {
  items: QualityReviewItem[];
  targetLang?: string;
  apiKey?: string;
  modelPreference?: string;
  allowPreview?: boolean;
  glossary?: GlossaryEntry[];
}
interface ReviewRow { id: string; status: "ok" | "suggested" | "needs_review"; suggestion?: string; reason?: string }
interface GeminiData {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
}
interface CompatibleData {
  choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: unknown } }>;
}
class ReviewResponseError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function boundedText(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= MAX_REVIEW_TEXT_LENGTH && (allowEmpty || !!value.trim());
}
function validRequest(value: unknown): value is ReviewRequest {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.length || value.items.length > MAX_REVIEW_ITEMS) return false;
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^(0|[1-9]\d{0,8})$/.test(item.id) || ids.has(item.id) || !boundedText(item.sourceText) || !boundedText(item.translatedText)) return false;
    ids.add(item.id);
  }
  if (!["targetLang", "apiKey", "modelPreference"].every(key => value[key] === undefined || boundedText(value[key], key === "apiKey"))) return false;
  if (value.allowPreview !== undefined && typeof value.allowPreview !== "boolean") return false;
  return value.glossary === undefined || (Array.isArray(value.glossary) && value.glossary.length <= 256 && value.glossary.every(entry => isRecord(entry) && boundedText(entry.source) && boundedText(entry.target) && (entry.note === undefined || boundedText(entry.note, true))));
}
function parseProviderReviews(text: unknown, items: QualityReviewItem[]): ReviewRow[] {
  if (typeof text !== "string" || text.length > MAX_BODY_BYTES) throw new ReviewResponseError(502, "INVALID_REVIEW_RESPONSE");
  let data: unknown;
  try { data = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")); }
  catch { throw new ReviewResponseError(502, "INVALID_REVIEW_RESPONSE"); }
  if (!isRecord(data) || !Array.isArray(data.reviews) || data.reviews.length > items.length) throw new ReviewResponseError(502, "INVALID_REVIEW_RESPONSE");
  const inputIds = new Set(items.map(item => item.id));
  const seen = new Set<string>();
  const reviews: ReviewRow[] = [];
  for (const row of data.reviews) {
    if (!isRecord(row) || typeof row.id !== "string" || !inputIds.has(row.id) || seen.has(row.id) || !["ok", "suggested", "needs_review"].includes(String(row.status)) || (row.reason !== undefined && !boundedText(row.reason, true)) || (row.suggestion !== undefined && !boundedText(row.suggestion)) || (row.status === "suggested" && !boundedText(row.suggestion))) throw new ReviewResponseError(502, "INVALID_REVIEW_RESPONSE");
    seen.add(row.id);
    reviews.push({ id: row.id, status: row.status as ReviewRow["status"], ...(typeof row.reason === "string" ? { reason: row.reason } : {}), ...(row.status === "suggested" ? { suggestion: row.suggestion as string } : {}) });
  }
  // Missing IDs stay absent; the client records them as unavailable.
  return reviews;
}
function geminiText(data: GeminiData): string | undefined {
  const candidate = data?.candidates?.[0];
  if (data?.promptFeedback?.blockReason || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(candidate?.finishReason ?? "")) throw new ReviewResponseError(400, "SAFETY_BLOCKED");
  return candidate?.content?.parts?.map(part => part.text ?? "").join("");
}

export async function POST(req: Request): Promise<Response> {
  try {
    throwIfRequestAborted(req.signal);
    if (Number(req.headers.get("content-length") || "0") > MAX_BODY_BYTES) return NextResponse.json({ error: "Review request is too large", code: "INVALID_REQUEST" }, { status: 413 });
    let body: unknown;
    try {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return NextResponse.json({ error: "Review request is too large", code: "INVALID_REQUEST" }, { status: 413 });
      body = JSON.parse(raw);
    } catch { return NextResponse.json({ error: "Invalid review payload", code: "INVALID_REQUEST" }, { status: 400 }); }
    if (!validRequest(body)) return NextResponse.json({ error: "Invalid review payload", code: "INVALID_REQUEST" }, { status: 400 });
    const prompt = buildQualityReviewPrompt(body.items, body.targetLang || "Thai", body.glossary);
    const reviews = await withGeminiDeadline(async signal => {
      const baseUrl = process.env.SUPERK_TRANSLATE_BASE_URL;
      const apiKey = process.env.SUPERK_TRANSLATE_API_KEY;
      if (baseUrl && apiKey) {
        const result = await requestOpenAICompatible<CompatibleData>({
          baseUrl, apiKey, model: process.env.SUPERK_TRANSLATE_MODEL || "11asd",
          payload: { messages: [{ role: "user", content: prompt }], temperature: 0.1, max_tokens: 8192, stream: false },
          signal, attemptTimeoutMs: 20_000, totalBudgetMs: REVIEW_BUDGET_MS,
        });
        throwIfRequestAborted(signal);
        const choice = result.data?.choices?.[0];
        if (choice?.message?.refusal || ["content_filter", "safety"].includes(choice?.finish_reason ?? "")) throw new ReviewResponseError(400, "SAFETY_BLOCKED");
        return parseProviderReviews(choice?.message?.content, body.items);
      }
      const result = await executeGeminiTranslation<GeminiData>({
        workflow: "text", userApiKeyRaw: body.apiKey, serverApiKeyRaw: process.env.GEMINI_API_KEY,
        modelPreference: body.modelPreference || "auto", allowPreview: body.allowPreview === true,
        signal, attemptTimeoutMs: 20_000, totalBudgetMs: REVIEW_BUDGET_MS,
        payload: { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } },
        validateSuccess: data => {
          try { parseProviderReviews(geminiText(data), body.items); return true; } catch { return false; }
        },
      });
      throwIfRequestAborted(signal);
      return parseProviderReviews(geminiText(result.data), body.items);
    }, REVIEW_BUDGET_MS, req.signal);
    const guardedReviews = reviews.map(row => {
      const item = body.items.find(item => item.id === row.id)!;
      const guarded = guardQualityReview({ ...row, sourceText: item.sourceText, reviewedText: item.translatedText }, body.targetLang);
      return { id: row.id, status: guarded.status, ...(guarded.reason !== undefined ? {reason:guarded.reason} : {}),
        ...(guarded.suggestion !== undefined ? {suggestion:guarded.suggestion} : {}) };
    });
    return NextResponse.json({ reviews: guardedReviews });
  } catch (error) {
    if (req.signal.aborted || (error instanceof GeminiRequestError && error.code === "REQUEST_ABORTED") || (error instanceof Error && error.name === "AbortError")) return NextResponse.json({ error: "Review cancelled", code: "REQUEST_ABORTED" }, { status: 499 });
    if (error instanceof ReviewResponseError) return NextResponse.json({ error: "Review unavailable", code: error.code }, { status: error.status });
    if (error instanceof GeminiRequestError) return NextResponse.json({ error: "Review unavailable", code: error.code, retryable: error.retryable }, { status: error.status });
    if (error instanceof GeminiRoutingError) return NextResponse.json({ error: "Review unavailable", code: error.code }, { status: geminiRoutingHttpStatus(error) });
    if (isRecord(error) && error.name === "TimeoutError") return NextResponse.json({ error: "Review timed out", code: "GEMINI_TIMEOUT" }, { status: 504 });
    return NextResponse.json({ error: "Review unavailable", code: "INVALID_REVIEW_RESPONSE" }, { status: 502 });
  }
}
