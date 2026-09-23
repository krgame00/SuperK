import { NextResponse } from "next/server";

import {
  GeminiRequestError,
  requestGemini,
  requestOpenAICompatible,
} from "@/lib/server/geminiRequest";
import { GeminiRoutingError } from "@/lib/server/geminiCatalog";
import {
  executeGeminiTranslation,
  geminiRoutingHttpStatus,
} from "@/lib/server/geminiTranslationRouter";
import {
  type TranslationPolicy,
  buildPolicyDirectives,
} from "@/lib/translationPolicy";
import {
  type GlossaryEntry,
  buildGlossaryDirectives,
} from "@/lib/translation/glossary";
import type { TranslationObservabilityMeta } from "@/lib/translation/requestError";

export const MAX_TRANSLATION_BODY_BYTES = 30 * 1024 * 1024;
export const MAX_TRANSLATION_IMAGE_BYTES = 20 * 1024 * 1024;

const FIXED_IMAGE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
];
let fixedImageKeyIndex = 0;

interface GeminiResponseData {
  promptFeedback?: {
    blockReason?: string;
  };
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

export function buildTranslationPrompt({
  targetLang,
  sourceLang,
  isRetry,
  context,
  policy,
  glossary,
}: {
  targetLang?: string;
  sourceLang?: string;
  isRetry?: boolean;
  context?: string;
  policy?: Partial<TranslationPolicy>;
  glossary?: GlossaryEntry[];
}): string {
  const sourceHint =
    sourceLang && sourceLang !== "auto"
      ? `The source language is ${sourceLang}. `
      : "";

  const retryDirective = isRetry
    ? `\nCRITICAL RETRY ATTEMPT: The previous OCR attempt detected 0 text bubbles. Re-examine the image with high precision. Pay close attention to faint, handwritten, small, stylized, red, or vertical text inside bubbles or floating text. Do NOT skip any dialogue.\n`
    : "";

  const contextDirective = context
    ? `\nCONTEXT (translations from previous pages of this same manga):\n${context}\n\nCONSISTENCY RULES:\n- Use the exact same character names, pronouns (แก/ฉัน/นาย/ข้า/เอ็ง), and tone of address already established in the context above. Do NOT change them.\n- Keep speech patterns and slang consistent with earlier pages.\n- If a character is referred to by a name in context, keep using that name.\n- Context is ONLY for consistency reference: translate THIS page fresh; do not copy dialogue.\n`
    : "";

  const glossaryDirective = buildGlossaryDirectives(glossary);
  const policyRules = buildPolicyDirectives(policy);

  return (
    `You are an expert manga translator. ${sourceHint}Translate this manga page to ${targetLang || "Thai"}.${retryDirective}${contextDirective}${glossaryDirective}\n` +
    `- Use highly natural, conversational flow appropriate for comic books. Avoid rigid word-for-word translation.\n` +
    `- Arrange sentences beautifully according to native Thai idioms and phrasing (เรียบเรียงประโยคให้สละสลวยเหมือนคนไทยพูดกันในชีวิตจริง ไม่แปลตรงตัว).\n` +
    `- Do NOT use line breaks (\\n) in the translated text. Keep the text of each bubble on a single continuous line (ห้ามเว้นบรรทัดมั่ว ให้ต่อเป็นบรรทัดเดียวกัน).\n` +
    `- For Thai: Adapt pronouns (แก, ฉัน, นาย, ข้า, เอ็ง) and endings (ครับ, ค่ะ, วะ, เว้ย, สิ, นะ) based on character relationships and mood.\n` +
    `${policyRules}\n` +
    `- Read order is usually Right-to-Left, Top-to-Bottom.\n` +
    `- Classify each detected text region as styleCategory: dialogue, narration, or sfx. This is metadata only and must not change translation wording.\n` +
    `Output ONLY valid JSON, no markdown, no explanation.\n` +
    `Format: {"bubbles":[{"original_text": "text found in image", "t":"translated text in Thai","box":[ymin, xmin, ymax, xmax],"styleCategory":"dialogue"}]}\n` +
    `box: bounding box coordinates in 0-1000 scale (ymin, xmin = top-left, ymax, xmax = bottom-right).\n` +
    `ALL translations in 't' MUST be in ${targetLang || "Thai"}.\n` +
    `If no text found: {"bubbles":[]}`
  );
}

export async function POST(req: Request) {
  if (req.headers.get("accept")?.includes("application/x-ndjson")) {
    return streamTranslationResponse(req);
  }
  return handleTranslationRequest(req);
}

function streamTranslationResponse(req: Request): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      void (async () => {
        try {
          const response = await handleTranslationRequest(req, (event) =>
            send({ type: "model-switch", ...event }),
          );
          send({
            type: "result",
            status: response.status,
            data: await response.json(),
          });
        } catch {
          send({
            type: "result",
            status: 500,
            data: { error: "Internal Server Error" },
          });
        } finally {
          if (!closed) controller.close();
          closed = true;
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleTranslationRequest(
  req: Request,
  onModelSwitch?: (event: { model: string; fallbackCount: number }) => void,
) {
  try {
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_TRANSLATION_BODY_BYTES
    ) {
      return NextResponse.json(
        { error: "Translation request is too large" },
        { status: 413 },
      );
    }

    const {
      imageBase64,
      mimeType,
      targetLang,
      sourceLang,
      modelPreference,
      allowPreview,
      apiKey: userApiKey,
      isRetry,
      context,
      policy,
      glossary,
    } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "Missing image data" }, { status: 400 });
    }
    if (
      typeof imageBase64 !== "string" ||
      imageBase64.length > Math.ceil((MAX_TRANSLATION_IMAGE_BYTES * 4) / 3) + 4
    ) {
      return NextResponse.json(
        { error: "Translation image is too large" },
        { status: 413 },
      );
    }
    if (typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
      return NextResponse.json(
        { error: "Unsupported image MIME type" },
        { status: 415 },
      );
    }

    // 9router (OpenAI-compatible) path — faster, no NSFW block
    const translateBaseUrl = process.env.SUPERK_TRANSLATE_BASE_URL;
    const translateApiKey = process.env.SUPERK_TRANSLATE_API_KEY;

    if (translateBaseUrl && translateApiKey) {
      try {
        const openAiResponse = await handleOpenAICompatible({
          imageBase64,
          mimeType,
          targetLang,
          sourceLang,
          isRetry,
          context,
          policy,
          glossary,
          translateBaseUrl,
          translateApiKey,
        });
        if (openAiResponse.ok) {
          return openAiResponse;
        }
        console.warn(
          "9router translation failed, falling back to direct Gemini API...",
        );
      } catch (err) {
        console.warn(
          "9router unreachable, falling back to direct Gemini API...",
          err,
        );
      }
    }

    // Fallback: direct Gemini API through the shared health-aware router.

    const promptText = buildTranslationPrompt({
      targetLang,
      sourceLang,
      isRetry,
      context,
      policy,
      glossary,
    });

    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ],
      safetySettings: [
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    };

    let data: GeminiResponseData;
    let translationMeta: TranslationObservabilityMeta | undefined;
    const useFixedRouter = process.env.SUPERK_GEMINI_IMAGE_ROUTER === "fixed";
    const keyPool = Array.from(new Set(
      [userApiKey, process.env.GEMINI_API_KEY]
        .filter((raw): raw is string => typeof raw === "string")
        .flatMap((raw) => raw.split(",").map((key) => key.trim()).filter(Boolean)),
    ));

    try {
      if (useFixedRouter && keyPool.length === 0) {
        return NextResponse.json({
          error: "Server missing API Key. Please add GEMINI_API_KEY to .env or enter your own in Settings",
          code: "MISSING_KEY",
        }, { status: 500 });
      }
      const models = modelPreference && modelPreference !== "auto"
        ? [modelPreference]
        : isRetry
          ? [
              "gemini-3.8-flash",
              "gemini-3.7-flash",
              "gemini-3.6-flash",
              "gemini-3.5-flash-lite",
              "gemini-3-flash",
              "gemini-3.5-flash",
              "gemini-3.1-flash-lite",
            ]
          : FIXED_IMAGE_MODELS;
      const result = useFixedRouter
        ? await requestGemini<GeminiResponseData>({
            apiKeys: keyPool,
            models,
            payload,
            initialKeyIndex: fixedImageKeyIndex,
            attemptTimeoutMs: 60_000,
            totalBudgetMs: 180_000,
          })
        : await executeGeminiTranslation<GeminiResponseData>({
        workflow: "image",
        userApiKeyRaw: userApiKey,
        serverApiKeyRaw: process.env.GEMINI_API_KEY,
        modelPreference: modelPreference || "auto",
        allowPreview: allowPreview === true,
        payload,
        attemptTimeoutMs: 25_000,
        totalBudgetMs: 60_000,
        onModelSwitch,
        validateSuccess: (response) => {
          if (response.promptFeedback?.blockReason) return false;
          const candidate = response.candidates?.[0];
          if (
            candidate?.finishReason === "SAFETY" ||
            candidate?.finishReason === "PROHIBITED_CONTENT"
          ) return false;
          const text = candidate?.content?.parts?.[0]?.text;
          if (!text) return false;
          try {
            const parsed = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim());
            return Array.isArray(parsed?.bubbles);
          } catch {
            return false;
          }
        },
      });
      if (useFixedRouter) fixedImageKeyIndex = result.keyIndex;
      data = result.data;
      translationMeta = result.meta;
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        const safeMessage = useFixedRouter
          ? [...keyPool]
              .sort((left, right) => right.length - left.length)
              .reduce((message, key) => message.replaceAll(key, "[REDACTED]"), error.message)
          : error.message;
        return NextResponse.json(
          {
            error: safeMessage,
            code: error.code,
            retryable: error.retryable,
            retryAfterMs: error.retryAfterMs,
            model: error.model,
            meta: error.meta,
          },
          { status: error.status },
        );
      }
      if (error instanceof GeminiRoutingError) {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            retryable: Boolean(error.nextRetryAt),
            retryAfterMs: error.retryAfterMs,
            nextRetryAt: error.nextRetryAt,
            model: error.model,
          },
          { status: geminiRoutingHttpStatus(error) },
        );
      }
      throw error;
    }

    if (data.promptFeedback?.blockReason) {
      console.error("Prompt blocked by Gemini:", data.promptFeedback);
      return NextResponse.json(
        {
          error: `ภาพนี้ถูกปฏิเสธโดยระบบคัดกรองของ Google (เหตุผล: ${data.promptFeedback.blockReason})`,
          code: "SAFETY_BLOCKED",
        },
        { status: 400 },
      );
    }

    const candidate = data.candidates?.[0];
    if (
      candidate?.finishReason === "SAFETY" ||
      candidate?.finishReason === "PROHIBITED_CONTENT"
    ) {
      return NextResponse.json(
        {
          error: "เนื้อหาถูกแบนโดยระบบ Safety ของ AI",
          code: "SAFETY_BLOCKED",
        },
        { status: 400 },
      );
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      console.error(
        "Gemini returned unexpected format:",
        JSON.stringify(data, null, 2),
      );
      return NextResponse.json(
        { error: "AI ไม่สามารถอ่านข้อความจากภาพนี้ได้ หรือภาพถูกบล็อก" },
        { status: 500 },
      );
    }

    const cleanText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    return NextResponse.json({ text: cleanText, meta: translationMeta });
  } catch (error) {
    console.error("Translation Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

async function handleOpenAICompatible({
  imageBase64,
  mimeType,
  targetLang,
  sourceLang,
  isRetry,
  context,
  policy,
  glossary,
  translateBaseUrl,
  translateApiKey,
}: {
  imageBase64: string;
  mimeType: string;
  targetLang: string;
  sourceLang: string;
  isRetry: boolean;
  context: string | undefined;
  policy?: Partial<TranslationPolicy>;
  glossary?: GlossaryEntry[];
  translateBaseUrl: string;
  translateApiKey: string;
}) {
  const promptText = buildTranslationPrompt({
    targetLang,
    sourceLang,
    isRetry,
    context,
    policy,
    glossary,
  });

  // OpenAI-compatible payload with vision (image_url with data URI)
  const payload = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`,
            },
          },
        ],
      },
    ],
    max_tokens: 8192,
    temperature: 0.3,
    stream: false,
  };

  // Model: prefer 11asd combo (best of openrouter + gemini), fallback to combo name from env
  const model = process.env.SUPERK_TRANSLATE_MODEL || "11asd";

  try {
    const result = await requestOpenAICompatible<{
      choices: Array<{
        message: {
          content: string;
        };
        finish_reason: string;
      }>;
    }>({
      baseUrl: translateBaseUrl,
      apiKey: translateApiKey,
      model,
      payload,
      attemptTimeoutMs: 60_000,
      totalBudgetMs: 180_000,
    });

    const choice = result.data.choices?.[0];
    if (!choice?.message?.content) {
      console.error(
        "9router returned unexpected format:",
        JSON.stringify(result.data, null, 2),
      );
      return NextResponse.json(
        { error: "AI ไม่สามารถอ่านข้อความจากภาพนี้ได้" },
        { status: 500 },
      );
    }

    // Check for safety blocks in OpenAI format
    if (
      choice.finish_reason === "content_filter" ||
      choice.finish_reason === "safety"
    ) {
      return NextResponse.json(
        { error: "เนื้อหาถูกแบนโดยระบบ Safety" },
        { status: 400 },
      );
    }

    const cleanText = choice.message.content
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    return NextResponse.json({ text: cleanText });
  } catch (error) {
    if (error instanceof GeminiRequestError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          retryable: error.retryable,
          retryAfterMs: error.retryAfterMs,
        },
        { status: error.status },
      );
    }
    console.error("9router Translation Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
