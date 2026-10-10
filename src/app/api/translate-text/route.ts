import { NextResponse } from "next/server";

import {
  GeminiRequestError,
  requestGemini,
} from "@/lib/server/geminiRequest";
import { requireLocalRequest } from "@/lib/server/localRequest";
import { FIXED_IMAGE_MODELS } from "@/lib/translation/imageModelChoices";
import { getSyncedExtensionSettings } from "@/src/app/api/extension/settings/handler";

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

let fixedTextKeyIndex = 0;

export async function POST(req: Request) {
  try {
    const denial = requireLocalRequest(req);
    if (denial) return denial;
    const { bubbles, targetLang, modelPreference, policy, apiKey } = await req.json();
    
    if (!bubbles || !Array.isArray(bubbles)) {
      return NextResponse.json({ error: "Missing or invalid text data" }, { status: 400 });
    }

    if (bubbles.length === 0) {
      return NextResponse.json({ text: JSON.stringify({ bubbles: [] }) });
    }

    const parseKeyList = (raw: string | undefined) =>
      typeof raw === "string"
        ? raw.split(/[\s,;]+/).map((key) => key.trim()).filter(Boolean)
        : [];
    const userApiKeyRaw = typeof apiKey === "string" && apiKey.trim()
      ? apiKey
      : getSyncedExtensionSettings().geminiApiKey;
    const userKeys = Array.from(new Set(parseKeyList(userApiKeyRaw)));
    const serverKeys = Array.from(new Set(parseKeyList(process.env.GEMINI_API_KEY)));
    const apiKeys = Array.from(new Set([...userKeys, ...serverKeys]));
    const rotationLength = userKeys.length > 0 ? userKeys.length : apiKeys.length;
    if (apiKeys.length === 0) {
      return NextResponse.json({ error: "Server missing API Key. Please add GEMINI_API_KEY to .env" }, { status: 500 });
    }

    const sfxDirective = policy?.sfx === "ignore"
      ? "- IGNORE all Sound Effects (SFX). Do NOT translate them."
      : policy?.sfx === "preserve"
      ? "- PRESERVE Sound Effects (SFX) in original form without translation."
      : "- Translate Sound Effects (SFX) and wrap them in asterisks, e.g., *BOOM* or *ตู้ม*.";

    const promptText = 
      `You are an expert manga translator. Translate the following JSON list of text blocks to ${targetLang || 'Thai'}.\n`+
      `- Use highly natural, conversational flow appropriate for comic books. Avoid rigid word-for-word translation.\n`+
      `- Arrange sentences beautifully according to native Thai idioms and phrasing (เรียบเรียงประโยคให้สละสลวยเหมือนคนไทยพูดกันในชีวิตจริง ไม่แปลตรงตัว).\n`+
      `- Do NOT use line breaks (\\n) in the translated text. Keep the text of each bubble on a single continuous line (ห้ามเว้นบรรทัดมั่ว ให้ต่อเป็นบรรทัดเดียวกัน).\n`+
      `- For Thai: Adapt pronouns (แก, ฉัน, นาย, ข้า, เอ็ง) and endings (ครับ, ค่ะ, วะ, เว้ย, สิ, นะ) based on character relationships and mood.\n`+
      `${sfxDirective}\n`+
      `- Read order is usually Right-to-Left, Top-to-Bottom.\n`+
      `The input format is {"bubbles":[{"t":"original text","box":[ymin,xmin,ymax,xmax]}]}.\n`+
      `Output ONLY valid JSON, no markdown, no explanation.\n`+
      `IMPORTANT: The JSON key is 'bubbles', but this array contains ALL text blocks including floating text, stylized red text, background text, and SFX. Do NOT skip text just because it is not in a speech bubble.\n`+
      `CRITICAL: I will check if you missed any text. You must translate absolutely EVERY SINGLE piece of text provided.\n`+
      `The output format must be EXACTLY the same, but with the text translated:\n`+
      `{"bubbles":[{"t":"translated text","box":[ymin,xmin,ymax,xmax]}]}\n`+
      `Keep the 'box' arrays exactly the same as the input.\n`+
      `ALL translations MUST be in ${targetLang || 'Thai'}. Never use English unless target IS English.\n\n`+
      `INPUT DATA:\n`+
      JSON.stringify({ bubbles }, null, 2);

    const payload = {
      contents: [{
        parts: [
          { text: promptText }
        ]
      }],
      safetySettings: [
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    const models = modelPreference && modelPreference !== "auto"
      ? [modelPreference]
      : [...FIXED_IMAGE_MODELS];

    let initialKeyIndex = 0;
    if (rotationLength > 0) {
      initialKeyIndex = fixedTextKeyIndex % rotationLength;
      fixedTextKeyIndex = (fixedTextKeyIndex + 1) % rotationLength;
    }

    let data: GeminiResponseData;
    try {
      const result = await requestGemini<GeminiResponseData>({
        apiKeys,
        models,
        payload,
        initialKeyIndex,
        attemptTimeoutMs: 15_000,
        totalBudgetMs: 60_000,
      });
      if (rotationLength > 0) {
        fixedTextKeyIndex = ((result.keyIndex % rotationLength) + 1) % rotationLength;
      }
      data = result.data;
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        const safeMessage = [...apiKeys]
          .sort((left, right) => right.length - left.length)
          .reduce((message, key) => message.replaceAll(key, "[REDACTED]"), error.message);
        return NextResponse.json(
          {
            error: safeMessage,
            code: error.code,
            retryable: error.retryable,
          },
          { status: error.status },
        );
      }
      throw error;
    }

    if (data.promptFeedback?.blockReason) {
      console.error("Prompt blocked by Gemini:", data.promptFeedback);
      return NextResponse.json({ error: `เนื้อหาถูกปฏิเสธโดยระบบคัดกรอง (เหตุผล: ${data.promptFeedback.blockReason})` }, { status: 400 });
    }

    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === "SAFETY" || candidate?.finishReason === "PROHIBITED_CONTENT") {
      return NextResponse.json({ error: "เนื้อหาถูกแบนโดยระบบ Safety ของ AI" }, { status: 400 });
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("Gemini returned unexpected format:", JSON.stringify(data, null, 2));
      return NextResponse.json({ error: "AI ไม่สามารถอ่านข้อความนี้ได้" }, { status: 500 });
    }

    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return NextResponse.json({ text: cleanText });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
