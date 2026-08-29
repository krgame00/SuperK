import { NextResponse } from "next/server";

import {
  GeminiRequestError,
  requestGemini,
} from "@/lib/server/geminiRequest";

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
    const { bubbles, targetLang, modelPreference, policy } = await req.json();
    
    if (!bubbles || !Array.isArray(bubbles)) {
      return NextResponse.json({ error: "Missing or invalid text data" }, { status: 400 });
    }

    if (bubbles.length === 0) {
      return NextResponse.json({ text: JSON.stringify({ bubbles: [] }) });
    }

    const apiKeyRaw = process.env.GEMINI_API_KEY;
    if (!apiKeyRaw) {
      return NextResponse.json({ error: "Server missing API Key. Please add GEMINI_API_KEY to .env" }, { status: 500 });
    }
    const apiKeys = apiKeyRaw
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

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

    let MODELS = [
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite"
    ];

    if (modelPreference && modelPreference !== "auto") {
      MODELS = [modelPreference];
    }

    let data: GeminiResponseData;
    try {
      const result = await requestGemini<GeminiResponseData>({
        apiKeys,
        models: MODELS,
        payload,
      });
      data = result.data;
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
