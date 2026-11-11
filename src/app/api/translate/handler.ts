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
  type FlexibleGlossaryEntry,
  buildGlossaryDirectives,
} from "@/lib/translation/glossary";
import {
  type PronounRelation,
  buildPronounMatrixDirectives,
} from "@/lib/translation/pronounMatrix";
import type { TranslationObservabilityMeta } from "@/lib/translation/requestError";
import { FIXED_IMAGE_MODELS } from "@/lib/translation/imageModelChoices";
import { getSyncedExtensionSettings } from "@/src/app/api/extension/settings/handler";
import { requireLocalRequest } from "@/lib/server/localRequest";
import {
  localErrorBodyFrom,
  localErrorStatus,
  localFailedBody,
  localNotConfiguredBody,
} from "@/lib/server/localEngine";
import { writeServerLog } from "@/lib/logger/serverLogger";
import { sanitizeTranslationPayloadJson } from "@/lib/translation/sanitizer";
import {
  parseModelPreference,
  type ModelPreferenceWire,
} from "@/lib/translation/modelPreference";

export const MAX_TRANSLATION_BODY_BYTES = 30 * 1024 * 1024;
export const MAX_TRANSLATION_IMAGE_BYTES = 20 * 1024 * 1024;

let fixedImageKeyIndex = 0;

interface TranslationRequestPayload {
  imageBase64?: string;
  mimeType?: string;
  targetLang?: string;
  sourceLang?: string;
  modelPreference?: ModelPreferenceWire;
  allowPreview?: boolean;
  apiKey?: string;
  isRetry?: boolean;
  context?: string;
  policy?: Partial<TranslationPolicy>;
  glossary?: FlexibleGlossaryEntry[];
  pronounMatrix?: PronounRelation[];
}

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
  pronounMatrix,
}: {
  targetLang?: string;
  sourceLang?: string;
  isRetry?: boolean;
  context?: string;
  policy?: Partial<TranslationPolicy>;
  glossary?: FlexibleGlossaryEntry[];
  pronounMatrix?: PronounRelation[];
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
  const pronounDirective = buildPronounMatrixDirectives(pronounMatrix);
  const policyRules = buildPolicyDirectives(policy);
  // Foreign-script leakage (Japanese kana/kanji carried over from the source
  // page, Cyrillic glitch runs) is a recurring Gemini failure mode for Thai
  // output — forbid it explicitly; the client's script guard retries when it
  // still slips through.
  const isThaiTarget =
    !targetLang ||
    /^(th(?:-[a-z0-9]+)?|thai|ไทย)$/i.test(targetLang.trim()) ||
    /thai|ไทย/i.test(targetLang);
  const targetLanguageLabel = isThaiTarget ? "Thai" : (targetLang || "Thai");
  const thaiTargetDirective = isThaiTarget
    ? `- Write 't' ENTIRELY in Thai script. Do NOT leave any Chinese characters (simplified or traditional, e.g. 原来/這是/行為/這裡), Japanese kana/kanji, Cyrillic, Hangul, Latin/English letters (A-Z, a-z), or other foreign-script characters in 't'. The source page may itself be written in Chinese — never copy, echo, or transliterate it back as Chinese; translate EVERY word, proper name, interjection (e.g., SHH -> ชู่ว), and sound effect into pure Thai script.\n`
    : "";

  return (
    `You are an expert manga translator. ${sourceHint}Translate this manga page to ${targetLanguageLabel}.${retryDirective}${contextDirective}${glossaryDirective}${pronounDirective}\n` +
    `- Capture original_text EXACTLY as visible in each text region, preserving the source wording. Do not rewrite, translate, or guess unreadable source text.\n` +
    `- Preserve the complete source meaning in 't'. Do not omit or add meaning, invent pronouns, names, relationships, actions, or events. Preserve uncertainty and implied subjects rather than guessing. Natural phrasing must never alter meaning.\n` +
    `- Use highly natural, conversational flow appropriate for comic books. Avoid rigid word-for-word translation.\n` +
    `- Arrange sentences beautifully according to native Thai idioms and phrasing (เรียบเรียงประโยคให้สละสลวยเหมือนคนไทยพูดกันในชีวิตจริง ไม่แปลตรงตัว).\n` +
    `- Do NOT merge visually separate text blocks, floating paragraphs, or distinct character profile/status sections into a single bubble. Output each distinct speech bubble, floating paragraph, or profile section (e.g., Title/Bio, Talent, Characteristics, Acquired Skills) as its own separate entry in "bubbles" with its exact bounding box [ymin, xmin, ymax, xmax] at its original position.\n` +
    `- Capture ALL dialogue, monologue, and narration text inside speech bubbles, rectangular or trapezoidal boxes, narrative captions, slanted/tilted dialogue boxes, and thought containers (ทั้งบอลลูนกลม/รี, กล่องสี่เหลี่ยม, กล่องคำพูดทรงเฉียง, กล่องบรรยาย). Do NOT skip text simply because it is enclosed in an angled, sharp, or rectangular border.\n` +
    `- Capture floating text outside bubbles (ข้อความลอยนอกกรอบ): muttered dialogue, background character chatter, floating asides, and narrative text printed directly over manga art without enclosing borders.\n` +
    `- Capture small handwritten text beside panels or character faces (chibi text, scribbled side-reactions, mutterings, whispers, or small explanatory notes next to dialogue). Bounding each distinct note in its own box.\n` +
    `- Capture ALL visible character dialogue, speech, vocalizations, moans, gasps, and reactions (e.g. Ah~, Ha~, Ahn!, Mm~, Kya~, Ngh, Haa, Fuh...). Character vocalizations and moans count as dialogue/reactions — translate or transliterate them into natural Thai expressions (เช่น ฮ่า~, อ๊ะ~, อ๊าง!, อื้ม~, กรี๊ด~, ฮึ่ม) and do NOT skip them.\n` +
    `- For table of contents, member lists, and character profile cards, capture and translate each section title, member name, and page reference.\n` +
    `- For multiline speech bubbles or stuttered phrases (e.g., "N-\\n\\nNO, I JUST..."), the bounding box MUST enclose the ENTIRE bubble from top to bottom, including any starter letters at the top.\n` +
    `- For normal speech bubbles, do NOT use line breaks (\\n) in the translated text. Keep the text of each speech bubble on a single continuous line (ห้ามเว้นบรรทัดมั่ว ให้ต่อเป็นบรรทัดเดียวกัน). However, if a text block is a bulleted list (• or -) or a section heading followed by bullet items, preserve "\\n• " before each bullet item so the list layout matches the original image.\n` +
    `- For Thai: Adapt pronouns (แก, ฉัน, นาย, ข้า, เอ็ง) and endings (ครับ, ค่ะ, วะ, เว้ย, สิ, นะ) based on character relationships and mood.\n` +
    `${policyRules}\n` +
    `${thaiTargetDirective}` +
    `- Read order is usually Right-to-Left, Top-to-Bottom.\n` +
    `- Classify each detected text region as styleCategory: dialogue, narration, or sfx. This is metadata only and must not change translation wording.\n` +
    `- Identify the speaker or speaker type in "speaker" (e.g. character name matching the pronoun matrix or glossary if recognized, or role/descriptor like "พระเอก", "นางเอก", or empty string "" if narrator/unspecified).\n` +
    `- If a text region is visibly tilted/angled (e.g., slanted shouting text, SFX, or tilted signs like "THE BULL... DEMON IS ANGRY!"), include "rotation" (tilt angle in degrees from -45 to 45; negative = tilted upward to the right, positive = tilted downward to the right, 0 = horizontal) and "italic": true when the letters are slanted/italicized.\n` +
    `Output ONLY valid JSON, no markdown, no explanation.\n` +
    `Format: {"bubbles":[{"original_text": "text found in image", "t":"translated text in Thai","box":[ymin, xmin, ymax, xmax],"speaker":"character name or role","styleCategory":"dialogue","rotation":0,"italic":false}]}\n` +
    `box: bounding box coordinates in 0-1000 scale (ymin, xmin = top-left, ymax, xmax = bottom-right). For multiline text in speech bubbles, the box MUST enclose ALL lines within that bubble from top to bottom.\n` +
    `ALL translations in 't' MUST be in ${targetLanguageLabel}.\n` +
    `If no text found: {"bubbles":[]}`
  );
}

export async function POST(req: Request) {
  const denial = requireLocalRequest(req);
  if (denial) return denial;
  if (req.headers.get("accept")?.includes("application/x-ndjson")) {
    return streamTranslationResponse(req);
  }
  // req.signal aborts when the client disconnects — Gemini calls stop too.
  return handleTranslationRequest(req, undefined, req.signal);
}

function streamTranslationResponse(req: Request): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const upstreamAbort = new AbortController();
  // The stream's cancel() fires when the client disconnects mid-read.
  if (req.signal) {
    req.signal.addEventListener(
      "abort",
      () => upstreamAbort.abort(),
      { once: true },
    );
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Reader went away between the check and the enqueue.
          closed = true;
        }
      };
      void (async () => {
        try {
          const response = await handleTranslationRequest(
            req,
            (event) => send({ type: "model-switch", ...event }),
            upstreamAbort.signal,
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
      // Stop the upstream Gemini work — the caller is gone.
      upstreamAbort.abort();
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
  signal?: AbortSignal,
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid translation payload", code: "INVALID_REQUEST" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid translation payload", code: "INVALID_REQUEST" }, { status: 400 });
    }
    const fields = body as Record<string, unknown>;
    const validStrings = ["targetLang", "sourceLang", "apiKey", "context"]
      .every((key) => fields[key] === undefined || typeof fields[key] === "string");
    const validBooleans = ["isRetry", "allowPreview"]
      .every((key) => fields[key] === undefined || typeof fields[key] === "boolean");
    const validPolicy = fields.policy === undefined ||
      (fields.policy !== null && typeof fields.policy === "object" && !Array.isArray(fields.policy));
    if (!validStrings || !validBooleans || !validPolicy ||
        (fields.glossary !== undefined && !Array.isArray(fields.glossary)) ||
        (fields.pronounMatrix !== undefined && !Array.isArray(fields.pronounMatrix))) {
      return NextResponse.json({ error: "Invalid translation payload", code: "INVALID_REQUEST" }, { status: 400 });
    }
    const {
      imageBase64,
      mimeType,
      targetLang = "Thai",
      sourceLang = "auto",
      modelPreference: modelPreferenceWire,
      allowPreview,
      apiKey: userApiKey,
      isRetry = false,
      context,
      policy,
      glossary,
      pronounMatrix,
    } = body as TranslationRequestPayload;

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

    const syncedSettings = getSyncedExtensionSettings();
    const effectiveUserApiKey =
      userApiKey && userApiKey.trim().length > 0
        ? userApiKey
        : syncedSettings.geminiApiKey && syncedSettings.geminiApiKey.trim().length > 0
          ? syncedSettings.geminiApiKey
          : userApiKey;
    const effectiveGlossary =
      glossary && glossary.length > 0
        ? glossary
        : syncedSettings.glossary.length > 0
          ? syncedSettings.glossary
          : glossary;

    const parsedPreference = parseModelPreference(modelPreferenceWire);
    if (!parsedPreference) {
      return NextResponse.json({ error: "Invalid translation payload", code: "INVALID_REQUEST" }, { status: 400 });
    }
    if (parsedPreference.engine === "local") {
      return handleLocalTranslate({
        imageBase64,
        mimeType,
        targetLang,
        sourceLang,
        isRetry,
        context,
        policy,
        glossary: effectiveGlossary,
        pronounMatrix,
        preference: parsedPreference,
        signal,
      });
    }
    // Cloud branches keep speaking model-id strings.
    const modelPreference = parsedPreference.engine === "gemini" ? parsedPreference.model : "auto";

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
          glossary: effectiveGlossary,
          pronounMatrix,
          translateBaseUrl,
          translateApiKey,
          signal,
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

    // Fallback: direct Gemini API through the verified fixed router by default
    // (or dynamic catalog router when SUPERK_GEMINI_IMAGE_ROUTER=dynamic).

    const promptText = buildTranslationPrompt({
      targetLang,
      sourceLang,
      isRetry,
      context,
      policy,
      glossary: effectiveGlossary,
      pronounMatrix,
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
    const useFixedRouter = process.env.SUPERK_GEMINI_IMAGE_ROUTER !== "dynamic";
    const parseKeyList = (raw: string | undefined) =>
      typeof raw === "string"
        ? raw.split(/[\s,;]+/).map((key) => key.trim()).filter(Boolean)
        : [];
    const userKeys = Array.from(new Set(parseKeyList(effectiveUserApiKey)));
    const serverKeys = Array.from(new Set(parseKeyList(process.env.GEMINI_API_KEY)));
    const keyPool = Array.from(new Set([...userKeys, ...serverKeys]));
    const rotationLength = userKeys.length > 0 ? userKeys.length : keyPool.length;

    try {
      if (useFixedRouter && keyPool.length === 0) {
        return NextResponse.json({
          error: "Server missing API Key. Please add GEMINI_API_KEY to .env or enter your own in Settings",
          code: "GEMINI_API_KEY_MISSING",
        }, { status: 500 });
      }
      const retryModels = [
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        ...FIXED_IMAGE_MODELS.filter((m) => m !== "gemini-3.8-flash" && m !== "gemini-3.5-flash-lite"),
      ];
      const models = modelPreference && modelPreference !== "auto"
        ? [modelPreference]
        : isRetry
          ? retryModels
          : [...FIXED_IMAGE_MODELS];
      let initialKeyIndex = 0;
      if (useFixedRouter && rotationLength > 0) {
        initialKeyIndex = fixedImageKeyIndex % rotationLength;
        fixedImageKeyIndex = (fixedImageKeyIndex + 1) % rotationLength;
      }
      const result = useFixedRouter
        ? await requestGemini<GeminiResponseData>({
            apiKeys: keyPool,
            models,
            payload,
            initialKeyIndex,
            attemptTimeoutMs: 28_000,
            totalBudgetMs: 120_000,
            signal,
          })
        : await executeGeminiTranslation<GeminiResponseData>({
        workflow: "image",
        signal,
        userApiKeyRaw: effectiveUserApiKey,
        serverApiKeyRaw: process.env.GEMINI_API_KEY,
        modelPreference: modelPreference || (isRetry ? "gemini-3.5-flash-lite" : "auto"),
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
            if (!Array.isArray(parsed?.bubbles)) return false;
            // "No text found" is a legitimate answer for a blank page.
            if (parsed.bubbles.length === 0) return true;
            // Bubbles with no text at all are placeholders, not a translation —
            // rotate to the next model instead of accepting them.
            const joined = parsed.bubbles.map((b: { t?: unknown }) => String(b?.t ?? "")).join(" ");
            if (!joined.trim()) return false;
            // Thai-target echo guard: Gemini sometimes copies the Chinese
            // source back instead of translating — treat it as a failure so
            // the model rotation tries a different model.
            const isThai = !targetLang || /^(th(?:-[a-z0-9]+)?|thai|ไทย)$/i.test(String(targetLang).trim()) || /thai|ไทย/i.test(String(targetLang));
            if (isThai) {
              const cjk = (joined.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) ?? []).length;
              const thai = (joined.match(/[\u0E00-\u0E7F]/g) ?? []).length;
              if (cjk > thai) return false;
            }
            return true;
          } catch {
            return false;
          }
        },
      });
      if (useFixedRouter && rotationLength > 0) {
        fixedImageKeyIndex = (result.keyIndex + 1) % rotationLength;
      }
      data = result.data;
      translationMeta = result.meta;
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        const safeMessage = useFixedRouter
          ? [...keyPool]
              .sort((left, right) => right.length - left.length)
              .reduce((message, key) => message.replaceAll(key, "[REDACTED]"), error.message)
          : error.message;
        writeServerLog({
          level: error.status >= 500 ? "error" : "warn",
          category: "translate",
          message: `Gemini API error [${error.status}]: ${safeMessage}`,
          details: { code: error.code, model: error.model, retryable: error.retryable, retryAfterMs: error.retryAfterMs },
        });
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
        writeServerLog({
          level: "warn",
          category: "translate",
          message: `Gemini routing error: ${error.message} (code: ${error.code})`,
          details: { code: error.code, model: error.model, retryAfterMs: error.retryAfterMs },
        });
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
      writeServerLog({
        level: "warn",
        category: "translate",
        message: `Prompt blocked by Gemini Safety: ${data.promptFeedback.blockReason}`,
        details: data.promptFeedback,
      });
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
      writeServerLog({
        level: "warn",
        category: "translate",
        message: `Translation candidate blocked by Safety filter (${candidate.finishReason})`,
        details: { finishReason: candidate.finishReason },
      });
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
      writeServerLog({
        level: "error",
        category: "translate",
        message: "Gemini returned empty or unexpected format response",
        details: data,
      });
      return NextResponse.json(
        { error: "AI ไม่สามารถอ่านข้อความจากภาพนี้ได้ หรือภาพถูกบล็อก" },
        { status: 500 },
      );
    }

    const cleanText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const sanitizedText = sanitizeTranslationPayloadJson(cleanText, targetLang);
    return NextResponse.json({ text: sanitizedText, meta: translationMeta });
  } catch (error) {
    console.error("Translation Error:", error);
    writeServerLog({
      level: "error",
      category: "translate",
      message: error instanceof Error ? error.message : "Translation server internal error",
      details: error instanceof Error ? { stack: error.stack } : error,
    });
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
  pronounMatrix,
  translateBaseUrl,
  translateApiKey,
  signal,
}: {
  imageBase64: string;
  mimeType: string;
  targetLang: string;
  sourceLang: string;
  isRetry: boolean;
  context: string | undefined;
  policy?: Partial<TranslationPolicy>;
  glossary?: FlexibleGlossaryEntry[];
  pronounMatrix?: PronounRelation[];
  translateBaseUrl: string;
  translateApiKey: string;
  signal?: AbortSignal;
}) {
  const promptText = buildTranslationPrompt({
    targetLang,
    sourceLang,
    isRetry,
    context,
    policy,
    glossary,
    pronounMatrix,
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
    response_format: { type: "json_object" },
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
      signal,
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
      writeServerLog({
        level: "warn",
        category: "translate",
        message: `9router content filter triggered (${choice.finish_reason})`,
      });
      return NextResponse.json(
        { error: "เนื้อหาถูกแบนโดยระบบ Safety" },
        { status: 400 },
      );
    }

    const cleanText = choice.message.content
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const sanitizedText = sanitizeTranslationPayloadJson(cleanText, targetLang);
    return NextResponse.json({ text: sanitizedText });
  } catch (error) {
    if (error instanceof GeminiRequestError) {
      writeServerLog({
        level: error.status >= 500 ? "error" : "warn",
        category: "translate",
        message: `9router API error [${error.status}]: ${error.message}`,
        details: { code: error.code, retryable: error.retryable, retryAfterMs: error.retryAfterMs },
      });
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
    writeServerLog({
      level: "error",
      category: "translate",
      message: error instanceof Error ? error.message : "9router internal error",
      details: error instanceof Error ? { stack: error.stack } : error,
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

async function handleLocalTranslate({
  imageBase64,
  mimeType,
  targetLang,
  sourceLang,
  isRetry,
  context,
  policy,
  glossary,
  pronounMatrix,
  preference,
  signal,
}: {
  imageBase64: string;
  mimeType: string;
  targetLang: string;
  sourceLang: string;
  isRetry: boolean;
  context: string | undefined;
  policy?: Partial<TranslationPolicy>;
  glossary?: FlexibleGlossaryEntry[];
  pronounMatrix?: PronounRelation[];
  preference: { engine: "local"; baseUrl: string; model: string };
  signal?: AbortSignal;
}) {
  if (!preference.baseUrl || !preference.model) {
    return NextResponse.json(localNotConfiguredBody(), { status: 400 });
  }

  const promptText = buildTranslationPrompt({
    targetLang,
    sourceLang,
    isRetry,
    context,
    policy,
    glossary,
    pronounMatrix,
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
    max_tokens: 2048,
    temperature: 0.2,
    frequency_penalty: 0.3,
    stream: false,
    response_format: { type: "json_object" },
  };

  try {
    const result = await requestOpenAICompatible<{
      choices: Array<{
        message: {
          content: string;
        };
        finish_reason: string;
      }>;
    }>({
      baseUrl: preference.baseUrl,
      apiKey: "",
      model: preference.model,
      payload,
      // A cold daemon must load a multi-GB vision model into VRAM before the
      // first token, so the local budget sits far above the 9router's.
      attemptTimeoutMs: 300_000,
      totalBudgetMs: 400_000,
      signal,
    });

    const choice = result.data.choices?.[0];
    if (!choice?.message?.content) {
      return NextResponse.json(
        localFailedBody("the local model returned no usable content"),
        { status: 502 },
      );
    }

    if (
      choice.finish_reason === "content_filter" ||
      choice.finish_reason === "safety"
    ) {
      writeServerLog({
        level: "warn",
        category: "translate",
        message: `Local engine content filter triggered (${choice.finish_reason})`,
      });
      return NextResponse.json(
        { error: "เนื้อหาถูกแบนโดยระบบ Safety", engine: "local" },
        { status: 400 },
      );
    }

    const cleanText = choice.message.content
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const sanitizedText = sanitizeTranslationPayloadJson(cleanText, targetLang);
    return NextResponse.json({ text: sanitizedText });
  } catch (error) {
    if (error instanceof GeminiRequestError) {
      const isMultimodalUnsupported =
        error.message.toLowerCase().includes("multimodal data provided") ||
        error.message.toLowerCase().includes("does not support multimodal");
      const isTimeout = error.code === "GEMINI_TIMEOUT" || error.status === 504;
      const friendlyDetail = isMultimodalUnsupported
        ? `โมเดล '${preference.model}' เป็นโมเดลข้อความเท่านั้น ไม่สามารถอ่านภาพมังงะได้ กรุณาเลือกโมเดลสายวิชั่น เช่น 'qwen2.5vl:7b' ในหน้าตั้งค่า`
        : isTimeout
          ? `Local Engine (${preference.model}) ใช้เวลาประมวลผลนานเกินกำหนด กรุณาลองใหม่อีกครั้ง`
          : error.message;

      writeServerLog({
        level: localErrorStatus(error) >= 500 ? "error" : "warn",
        category: "translate",
        message: `Local engine error [${error.status}]: ${friendlyDetail}`,
        details: { code: error.code, retryable: error.retryable, retryAfterMs: error.retryAfterMs },
      });
      return NextResponse.json(
        isMultimodalUnsupported || isTimeout
          ? {
              ...localErrorBodyFrom(error),
              error: `Local engine ${isTimeout ? "timeout" : "failed"}: ${friendlyDetail}. No cloud fallback was attempted.`,
            }
          : localErrorBodyFrom(error),
        { status: localErrorStatus(error) },
      );
    }
    console.error("Local Translation Error:", error);
    writeServerLog({
      level: "error",
      category: "translate",
      message: error instanceof Error ? error.message : "Local engine internal error",
      details: error instanceof Error ? { stack: error.stack } : error,
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
