import { NextResponse } from "next/server";

let globalKeyIndex = 0;

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
      `- IGNORE all Sound Effects (SFX). Do NOT translate them. Only translate spoken dialogues, thoughts, and narration.\n`+
      `- DO NOT hallucinate text on textures, leaves, clothing, shading, or backgrounds. If an area does not clearly contain readable text, ignore it completely.\n`+
      `- Read order is usually Right-to-Left, Top-to-Bottom.\n`+
      `Output ONLY valid JSON, no markdown, no explanation.\n`+
      `Format: {"bubbles":[{"original_text": "text found in image", "t":"translated text in Thai","box":[ymin, xmin, ymax, xmax]}]}\n`+
      `box: bounding box coordinates in 0-1000 scale (ymin, xmin = top-left, ymax, xmax = bottom-right).\n`+
      `IMPORTANT: The JSON key is 'bubbles', but you MUST include ALL dialogue blocks (including floating text, stylized red text, background text). Do NOT skip spoken text or thoughts.\n`+
      `CRITICAL: Force extraction. You must first transcribe the text into 'original_text', then translate it into 't'. I will check if you missed the large red text on the left.\n`+
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
      "gemini-3.5-flash",
      "gemini-3-flash",
      "gemini-2.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash-lite"
    ];

    if (isRetry && (!modelPreference || modelPreference === "auto")) {
      // On retry, try gemini-2.5-flash first as it has different OCR vision behavior
      MODELS = [
        "gemini-2.5-flash",
        "gemini-3-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash-lite"
      ];
    } else if (modelPreference && modelPreference !== "auto") {
      MODELS = [modelPreference];
    }

    let data = null;
    let resOk = false;
    let resStatus = 500;
    let firstError = null;

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (const model of MODELS) {
      let retryCount = 0;
      const maxRetries = 2; // 3 attempts total per model/key combo
      
      let keyAttempt = 0;
      let modelSuccess = false;

      while (keyAttempt < apiKeys.length) {
        const currentKey = apiKeys[(globalKeyIndex + keyAttempt) % apiKeys.length];
        
        while (retryCount <= maxRetries) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          data = await res.json();
          resOk = res.ok;
          resStatus = res.status;

          if (resOk) {
            modelSuccess = true;
            globalKeyIndex = (globalKeyIndex + keyAttempt) % apiKeys.length; // Stick to the working key
            break;
          }
          
          const errorMsg = data?.error?.message || "Unknown error";
          console.warn(`Model ${model} (Key ...${currentKey.slice(-4)}) failed with status ${res.status}: ${errorMsg}`);
          
          if (!firstError) firstError = errorMsg;
          
          // If 503 (Overloaded) or 500, retry with exponential backoff
          if (resStatus === 503 || resStatus === 500) {
            retryCount++;
            if (retryCount <= maxRetries) {
              const delay = retryCount * 2000; // 2s, then 4s
              console.log(`[High Demand] Retrying ${model} in ${delay}ms...`);
              await sleep(delay);
              continue; // Retry same model and key
            }
          }
          
          break; // Break retry loop for other errors (e.g. 429, 400, 403)
        }

        if (modelSuccess) break; // exit key loop
        
        // If 429 (Quota) or 403/400 (Invalid Key), try the next key!
        if (resStatus === 429 || resStatus === 403 || resStatus === 400) {
          console.warn(`Key ...${currentKey.slice(-4)} hit error ${resStatus} on ${model}. Trying next key...`);
          keyAttempt++;
          retryCount = 0; // reset retries for the new key
          continue;
        }
        
        break; // if it wasn't a quota or auth error, just stop trying keys and fallback to the next model
      }

      if (modelSuccess) break; // Success, exit model loop
      
      // If user specifically requested this model, don't fallback to anything else
      if (modelPreference && modelPreference !== "auto") break;
    }

    if (!resOk) {
      console.error("Gemini API Error after all fallbacks:", data);
      return NextResponse.json({ error: firstError || "Failed to translate from Gemini after multiple attempts" }, { status: resStatus });
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

    let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return NextResponse.json({ text: cleanText });

  } catch (error) {
    console.error("Translation Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
