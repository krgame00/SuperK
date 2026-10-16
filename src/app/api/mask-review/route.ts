import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  requestGemini,
  requestOpenAICompatible,
  throwIfRequestAborted,
  withGeminiDeadline,
} from "@/lib/server/geminiRequest";
import { GeminiRoutingError } from "@/lib/server/geminiCatalog";
import {
  executeGeminiTranslation,
  geminiRoutingHttpStatus,
} from "@/lib/server/geminiTranslationRouter";
import { FIXED_IMAGE_MODELS } from "@/lib/translation/imageModelChoices";
import { requireLocalRequest } from "@/lib/server/localRequest";
import { getSyncedExtensionSettings } from "@/src/app/api/extension/settings/handler";
import type {
  AiMaskVerdict,
  NormalizedRegionBox,
} from "@/lib/cleaning/aiMaskInspector";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MASK_REVIEW_BUDGET_MS = 35_000;

interface MaskReviewRequest {
  imageBase64: string;
  mimeType?: string;
  regionId?: string;
  localStats?: {
    currentPixels?: number;
    suggestedPixels?: number;
    addedCount?: number;
    removedCount?: number;
  };
  apiKey?: string;
  modelPreference?: string;
  allowPreview?: boolean;
}

interface GeminiData {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

interface CompatibleData {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string; refusal?: unknown };
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clampCoord(val: unknown): number {
  const num = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1000, Math.round(num)));
}

function normalizeBoxList(raw: unknown): NormalizedRegionBox[] {
  if (!Array.isArray(raw)) return [];
  const boxes: NormalizedRegionBox[] = [];
  for (const item of raw.slice(0, 24)) {
    if (!Array.isArray(item) || item.length < 4) continue;
    const y0 = clampCoord(item[0]);
    const x0 = clampCoord(item[1]);
    const y1 = clampCoord(item[2]);
    const x1 = clampCoord(item[3]);
    const ymin = Math.min(y0, y1);
    const ymax = Math.max(y0, y1);
    const xmin = Math.min(x0, x1);
    const xmax = Math.max(x0, x1);
    if (ymax - ymin >= 10 && xmax - xmin >= 10) {
      boxes.push([ymin, xmin, ymax, xmax]);
    }
  }
  return boxes;
}

function parseMaskReviewJson(rawText: string | undefined): {
  verdict: AiMaskVerdict;
  summary: string;
  addBoxes: NormalizedRegionBox[];
  protectBoxes: NormalizedRegionBox[];
} {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Empty mask review response");
  }
  const cleaned = rawText
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!isRecord(parsed)) {
    throw new Error("Invalid mask review JSON object");
  }
  const rawVerdict = String(parsed.verdict || "adjusted");
  const verdict: AiMaskVerdict = (
    ["good", "under_masked", "over_masked", "adjusted"] as const
  ).includes(rawVerdict as AiMaskVerdict)
    ? (rawVerdict as AiMaskVerdict)
    : "adjusted";
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.trim().slice(0, 400)
      : "วิเคราะห์ความแม่นยำของ Mask เรียบร้อยแล้ว";
  const addBoxes = normalizeBoxList(parsed.addBoxes);
  const protectBoxes = normalizeBoxList(parsed.protectBoxes);

  return { verdict, summary, addBoxes, protectBoxes };
}

function buildMaskReviewPrompt(localStats?: MaskReviewRequest["localStats"]): string {
  const hint = localStats
    ? `Local pixel detector found +${localStats.addedCount ?? 0} unmasked stroke pixels and -${localStats.removedCount ?? 0} over-masked border pixels.`
    : "";
  return [
    "You are a manga/webtoon text-cleaning mask quality auditor.",
    "The attached image shows 3 side-by-side panels of a single cropped text region:",
    "- Left panel: Original manga/webtoon region with source text.",
    "- Center panel: Current removal mask overlaid in RED on the original region.",
    "- Right panel: Current cleaned output after inpainting.",
    hint,
    "Inspect whether the RED mask in the center panel:",
    "1) Misses any source text strokes, punctuation, furigana, or leaves text remnants visible in the Right panel (under_masked).",
    "2) Bleeds onto speech bubble border lines, character hair/faces, or important background line art (over_masked).",
    "Return ONLY valid JSON with this exact schema:",
    "{",
    '  "verdict": "good" | "under_masked" | "over_masked" | "adjusted",',
    '  "summary": "คำอธิบายภาษาไทยสั้นๆ กระชับ เข้าใจง่าย ว่า Mask เดิมดีแล้ว หรือควรเก็บตัวอักษรตรงไหนเพิ่ม / ควรเว้นเส้นขอบตรงไหน",',
    '  "addBoxes": [[ymin, xmin, ymax, xmax]],',
    '  "protectBoxes": [[ymin, xmin, ymax, xmax]]',
    "}",
    "Notes on coordinates:",
    "- `addBoxes` and `protectBoxes` use 0..1000 coordinates relative to a SINGLE region panel (not the 3-panel strip width).",
    "- `addBoxes` marks missed text strokes that should be added to the removal mask.",
    "- `protectBoxes` marks bubble borders or artwork that should be excluded/protected from the mask.",
    "- Use empty arrays [] when no extra boxes are needed.",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractGeminiText(data: GeminiData): string | undefined {
  const candidate = data?.candidates?.[0];
  if (
    data?.promptFeedback?.blockReason ||
    ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(
      candidate?.finishReason ?? "",
    )
  ) {
    throw new Error("SAFETY_BLOCKED");
  }
  return candidate?.content?.parts?.map((part) => part.text ?? "").join("");
}

export async function POST(req: Request): Promise<Response> {
  const denial = requireLocalRequest(req);
  if (denial) return denial;

  try {
    throwIfRequestAborted(req.signal);
    if (Number(req.headers.get("content-length") || "0") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Mask review request is too large", code: "INVALID_REQUEST" },
        { status: 413 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid mask review payload", code: "INVALID_REQUEST" },
        { status: 400 },
      );
    }

    if (
      !isRecord(body) ||
      typeof body.imageBase64 !== "string" ||
      body.imageBase64.trim().length < 16
    ) {
      return NextResponse.json(
        { error: "Missing region comparison image", code: "INVALID_REQUEST" },
        { status: 400 },
      );
    }

    const payloadReq = body as unknown as MaskReviewRequest;
    const mimeType =
      typeof payloadReq.mimeType === "string" && payloadReq.mimeType.startsWith("image/")
        ? payloadReq.mimeType
        : "image/png";

    const syncedSettings = getSyncedExtensionSettings();
    const effectiveApiKey =
      payloadReq.apiKey && payloadReq.apiKey.trim().length > 0
        ? payloadReq.apiKey.trim()
        : syncedSettings.geminiApiKey && syncedSettings.geminiApiKey.trim().length > 0
          ? syncedSettings.geminiApiKey.trim()
          : undefined;

    const promptText = buildMaskReviewPrompt(payloadReq.localStats);

    const review = await withGeminiDeadline(
      async (signal) => {
        const baseUrl = process.env.SUPERK_TRANSLATE_BASE_URL;
        const openAiKey = process.env.SUPERK_TRANSLATE_API_KEY;
        if (baseUrl && openAiKey) {
          const compatResult = await requestOpenAICompatible<CompatibleData>({
            baseUrl,
            apiKey: openAiKey,
            model: process.env.SUPERK_TRANSLATE_MODEL || "11asd",
            payload: {
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: promptText },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:${mimeType};base64,${payloadReq.imageBase64}`,
                      },
                    },
                  ],
                },
              ],
              temperature: 0.1,
              max_tokens: 2048,
              stream: false,
            },
            signal,
            attemptTimeoutMs: 20_000,
            totalBudgetMs: MASK_REVIEW_BUDGET_MS,
          });
          throwIfRequestAborted(signal);
          const choice = compatResult.data?.choices?.[0];
          return parseMaskReviewJson(choice?.message?.content);
        }

        const geminiPayload = {
          contents: [
            {
              parts: [
                { text: promptText },
                {
                  inlineData: {
                    mimeType,
                    data: payloadReq.imageBase64,
                  },
                },
              ],
            },
          ],
          safetySettings: [
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        };

        const parseKeyList = (raw: string | undefined) =>
          typeof raw === "string"
            ? raw
                .split(/[\s,;]+/)
                .map((k) => k.trim())
                .filter(Boolean)
            : [];
        const keyPool = Array.from(
          new Set([
            ...parseKeyList(effectiveApiKey),
            ...parseKeyList(process.env.GEMINI_API_KEY),
          ]),
        );

        const useFixedRouter = process.env.SUPERK_GEMINI_IMAGE_ROUTER !== "dynamic";
        if (useFixedRouter && keyPool.length > 0) {
          const pref = payloadReq.modelPreference || syncedSettings.modelPreference;
          const models =
            pref && pref !== "auto" ? [pref] : [...FIXED_IMAGE_MODELS];
          const res = await requestGemini<GeminiData>({
            apiKeys: keyPool,
            models,
            payload: geminiPayload,
            attemptTimeoutMs: 18_000,
            totalBudgetMs: MASK_REVIEW_BUDGET_MS,
            signal,
          });
          throwIfRequestAborted(signal);
          return parseMaskReviewJson(extractGeminiText(res.data));
        }

        const res = await executeGeminiTranslation<GeminiData>({
          workflow: "image",
          userApiKeyRaw: effectiveApiKey,
          serverApiKeyRaw: process.env.GEMINI_API_KEY,
          modelPreference:
            payloadReq.modelPreference || syncedSettings.modelPreference || "auto",
          allowPreview:
            payloadReq.allowPreview ?? syncedSettings.allowPreviewModels === true,
          signal,
          attemptTimeoutMs: 20_000,
          totalBudgetMs: MASK_REVIEW_BUDGET_MS,
          payload: geminiPayload,
          validateSuccess: (data) => {
            try {
              parseMaskReviewJson(extractGeminiText(data));
              return true;
            } catch {
              return false;
            }
          },
        });
        throwIfRequestAborted(signal);
        return parseMaskReviewJson(extractGeminiText(res.data));
      },
      MASK_REVIEW_BUDGET_MS,
      req.signal,
    );

    return NextResponse.json(review);
  } catch (error) {
    if (
      req.signal.aborted ||
      (error instanceof GeminiRequestError && error.code === "REQUEST_ABORTED") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return NextResponse.json(
        { error: "ยกเลิกการวิเคราะห์ Mask แล้ว", code: "REQUEST_ABORTED" },
        { status: 499 },
      );
    }
    if (error instanceof GeminiRoutingError) {
      return NextResponse.json(
        {
          error: "ยังไม่ได้ตั้งค่า Gemini API Key หรือโควตาเต็ม (ระบบใช้ผลตรวจ Local AI แทนได้ทันที)",
          code: error.code,
        },
        { status: geminiRoutingHttpStatus(error) },
      );
    }
    return NextResponse.json(
      {
        error: "ไม่สามารถเชื่อมต่อ Gemini Vision ได้ในขณะนี้ (คุณยังใช้ผลตรวจ Local AI เทียบและปรับ Mask ได้ทันที)",
        code: "MASK_REVIEW_UNAVAILABLE",
      },
      { status: 502 },
    );
  }
}
