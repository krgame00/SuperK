import { NextResponse } from "next/server";

import {
  GeminiRequestError,
  requestGemini,
} from "@/lib/server/geminiRequest";

let globalKeyIndex = 0;

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

export async function POST(req: Request) {
  try {
    const { imageBase64, mimeType, targetLang, sourceLang, modelPreference, apiKey: customApiKey, isRetry } = await req.json();
    
    if (!imageBase64) {
      return NextResponse.json({ error: "Missing image data" }, { status: 400 });
    }

    const apiKeyRaw = customApiKey || process.env.GEMINI_API_KEY;
    if (!apiKeyRaw) {
      return NextResponse.json({ error: "Server missing API Key. Please add GEMINI_API_KEY to .env or enter your own in Settings" }, { status: 500 });
    }

    // Support multiple API keys separated by commas
    const apiKeys = apiKeyRaw.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);

    const sourceHint = sourceLang && sourceLang !== 'auto' ? `The source language is ${sourceLang}. ` : '';

    const retryDirective = isRetry 
      ? `\nCRITICAL RETRY ATTEMPT: The previous OCR attempt detected 0 text bubbles. Re-examine the image with high precision. Pay close attention to faint, handwritten, small, stylized, red, or vertical text inside bubbles or floating text. Do NOT skip any dialogue.\n`
      : '';

    const promptText = 
      `You are an expert manga translator. ${sourceHint}Translate this manga page to ${targetLang || 'Thai'}.${retryDirective}\n`+
      `- Use highly natural, conversational flow appropriate for comic books. Avoid rigid word-for-word translation.\n`+
      `- Arrange sentences beautifully according to native Thai idioms and phrasing (เรียบเรียงประโยคให้สละสลวยเหมือนคนไทยพูดกันในชีวิตจริง ไม่แปลตรงตัว).\n`+
      `- Do NOT use line breaks (\\n) in the translated text. Keep the text of each bubble on a single continuous line (ห้ามเว้นบรรทัดมั่ว ให้ต่อเป็นบรรทัดเดียวกัน).\n`+
      `- For Thai: Adapt pronouns (แก, ฉัน, นาย, ข้า, เอ็ง) and endings (ครับ, ค่ะ, วะ, เว้ย, สิ, นะ) based on character relationships and mood.\n`+
      `- Translate ONLY story-bearing dialogue, thoughts, and narration.\n`+
      `- Narration may appear without a speech bubble; include it when it forms a readable story sentence or caption.\n`+
      `- IGNORE interface text: HUD elements, menus, button labels, character or stat labels, counters, status values, credits, watermarks, and other small scattered labels.\n`+
      `- IGNORE all Sound Effects (SFX). Do NOT translate them.\n`+
      `- DO NOT hallucinate text on textures, leaves, clothing, shading, or backgrounds. If an area does not clearly contain readable story text, ignore it completely.\n`+
      `- Read order is usually Right-to-Left, Top-to-Bottom.\n`+
      `Output ONLY valid JSON, no markdown, no explanation.\n`+
      `Format: {"bubbles":[{"original_text": "text found in image", "t":"translated text in Thai","box":[ymin, xmin, ymax, xmax]}]}\n`+
      `box: bounding box coordinates in 0-1000 scale (ymin, xmin = top-left, ymax, xmax = bottom-right).\n`+
      `ALL translations in 't' MUST be in ${targetLang || 'Thai'}.\n`+
      `If no text found: {"bubbles":[]}`;

    const payload = {
      contents: [{
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: imageBase64
            }
          }
        ]
      }],
      safetySettings: [
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ]
    };

    let MODELS = [
      "gemini-3.5-flash-lite", // Fresh quota: 500 RPD, 15 RPM
      "gemini-3.6-flash",      // Fresh quota: 20 RPD, 5 RPM
      "gemini-3-flash",        // Fresh quota: 20 RPD, 5 RPM
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite"
    ];

    if (isRetry && (!modelPreference || modelPreference === "auto")) {
      // On retry, try gemini-3.6-flash first
      MODELS = [
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-3-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash"
      ];
    } else if (modelPreference && modelPreference !== "auto") {
      MODELS = [modelPreference];
    }

    let data: GeminiResponseData;
    try {
      const result = await requestGemini<GeminiResponseData>({
        apiKeys,
        models: MODELS,
        payload,
        initialKeyIndex: globalKeyIndex,
        // Multi-part image pages (6 tiles + text) routinely take >30s on
        // Gemini; raise the per-attempt cap so slow-but-healthy responses
        // don't get aborted as timeouts.
        attemptTimeoutMs: 60_000,
        totalBudgetMs: 180_000,
      });
      data = result.data;
      globalKeyIndex = result.keyIndex;
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        return NextResponse.json(
          {
            error: error.message,
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
      return NextResponse.json({ error: `ภาพนี้ถูกปฏิเสธโดยระบบคัดกรองของ Google (เหตุผล: ${data.promptFeedback.blockReason})` }, { status: 400 });
    }

    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === "SAFETY" || candidate?.finishReason === "PROHIBITED_CONTENT") {
      return NextResponse.json({ error: "เนื้อหาถูกแบนโดยระบบ Safety ของ AI" }, { status: 400 });
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("Gemini returned unexpected format:", JSON.stringify(data, null, 2));
      return NextResponse.json({ error: "AI ไม่สามารถอ่านข้อความจากภาพนี้ได้ หรือภาพถูกบล็อก" }, { status: 500 });
    }

    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return NextResponse.json({ text: cleanText });

  } catch (error) {
    console.error("Translation Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
