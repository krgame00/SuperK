if (typeof importScripts === "function") {
  importScripts("server.js");
}

chrome.runtime.onInstalled?.addListener?.(() => {
  chrome.contextMenus?.create?.({
    id: "superk-translate-image", title: "🪄 แปลภาพมังงะด้วย SuperK", contexts: ["image"]
  });
});

const pending = new Set();

async function runTranslationFlow(tabId, frameId, imageUrl) {
  if (tabId == null || !imageUrl) return;
  const key = JSON.stringify([tabId, frameId, imageUrl]);
  if (pending.has(key)) return;
  pending.add(key);
  const send = message => chrome.tabs.sendMessage(tabId, { ...message, imageUrl }, { frameId });
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  try {
    try { await send({ action: "TRANSLATION_START" }); }
    catch {
      const target = { tabId, frameIds: [frameId] };
      await chrome.scripting.insertCSS({ target, files: ["content.css"] });
      await chrome.scripting.executeScript({ target, files: ["content.js"] });
      await send({ action: "TRANSLATION_START" });
    }
    const image = await fetchImageAsBase64(imageUrl);
    const stored = await chrome.storage.sync.get({
      translationMode: "server", serverUrl: "http://127.0.0.1:3000",
      apiKey: "", targetLang: "Thai", sourceLang: "auto",
      modelPreference: "auto", cleanMode: "inpainting"
    });
    const synced = stored.translationMode === "direct"
      ? {}
      : await SuperKServer.fetchSettings(stored.serverUrl).catch(() => ({}));
    const settings = {
      ...stored,
      ...synced,
      apiKey: stored.apiKey || synced.geminiApiKey || "",
      modelPreference: stored.modelPreference || synced.modelPreference || "auto",
      cleanMode: (!synced.isOfflineFallback && synced.cleanMode) ? synced.cleanMode : (stored.cleanMode || "inpainting"),
    };

    let cleanImageBase64 = null;
    let cleanJobId = null;
    if (settings.cleanMode === "inpainting" && settings.translationMode !== "direct") {
      try {
        const cleanRes = await SuperKServer.inpaintImage(image, settings);
        cleanImageBase64 = cleanRes.cleanImageBase64;
        cleanJobId = cleanRes.jobId;
      } catch (cleanErr) {
        throw new Error(`Inpainting ล้มเหลว: ${cleanErr.message || 'ไม่สามารถลบข้อความต้นฉบับได้'}`);
      }
    }

    const result = settings.translationMode === "direct"
      ? await translateImageWithGemini(image.base64, settings, image.mimeType)
      : await SuperKServer.translate(image, settings);
    await send({
      action: "TRANSLATION_SUCCESS",
      bubbles: result.bubbles,
      cleanMode: settings.cleanMode,
      cleanImageBase64,
      cleanJobId,
      textStyle: settings.textStyle,
      isOfflineFallback: synced.isOfflineFallback || false,
    });
  } catch (error) {
    await send({ action: "TRANSLATION_ERROR", error: error.message || "แปลภาพไม่สำเร็จ" })
      .catch(() => console.warn("[SuperK] Tab unavailable:", error.message));
  } finally {
    clearInterval(keepAlive);
    pending.delete(key);
  }
}

chrome.contextMenus?.onClicked?.addListener?.(async (info, tab) => {
  if (info.menuItemId !== "superk-translate-image" || !info.srcUrl || tab?.id == null) return;
  await runTranslationFlow(tab.id, info.frameId ?? 0, info.srcUrl);
});

chrome.runtime.onMessage?.addListener?.(async (message, sender) => {
  if (message.action === "RETRY_TRANSLATE" && sender.tab?.id && message.imageUrl) {
    await runTranslationFlow(sender.tab.id, sender.frameId ?? 0, message.imageUrl);
  } else if (message.action === "OPEN_EDITOR" && message.payload) {
    try {
      const stored = await chrome.storage.sync.get({ serverUrl: "http://127.0.0.1:3000" });
      const appendUrl = `${stored.serverUrl}/api/extension/workspace/append`;
      const res = await fetch(appendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message.payload),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (data.editUrl && chrome.tabs?.create) {
        await chrome.tabs.create({ url: data.editUrl });
      }
    } catch (err) {
      console.error("[SuperK] Failed to open in editor:", err);
    }
  }
});

async function fetchImageAsBase64(url) {
  if (!/^(https?:|data:image\/)/i.test(url)) {
    throw new Error("ภาพชนิดนี้ยังไม่รองรับ กรุณาบันทึกภาพแล้วเปิดในเว็บ SuperK");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("โหลดภาพไม่ได้ (HTTP " + response.status + ")");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("ลิงก์นี้ไม่ได้ส่งไฟล์ภาพกลับมา");
  if (blob.size > 20 * 1024 * 1024) throw new Error("ภาพใหญ่เกิน 20 MB กรุณาย่อภาพก่อน");
  return { base64: await SuperKServer.blobToBase64(blob), mimeType: blob.type };
}

// Helper: Call Gemini API with model rotation & retries
async function translateImageWithGemini(base64Data, settings, mimeType) {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    throw new Error("กรุณาใส่ Gemini API Key ในเมนู Extension ก่อนใช้งานครับ!");
  }

  const prompt = `You are an expert manga and webtoon translator. Detect all speech bubbles, text boxes, captions, and floating text in this image. Translate to ${settings.targetLang || 'Thai'}.
CRITICAL RULES FOR BOUNDING BOXES:
1. For multiline paragraphs, captions, or full text overlays, merge all lines into ONE SINGLE bounding box covering the entire text block [ymin, xmin, ymax, xmax]. Do NOT split multiline paragraphs into separate single-line boxes!
2. Ensure the bounding box tightly bounds the entire text block including top, bottom, left, and right margins.

Output ONLY valid JSON matching this schema:
{
  "bubbles": [
    {
      "original_text": "full text in image",
      "t": "translated text in ${settings.targetLang || 'Thai'}",
      "box": [ymin, xmin, ymax, xmax]
    }
  ]
}
Notes:
- box coordinates MUST be integers 0-1000 representing [ymin, xmin, ymax, xmax] of the EXACT text area.
- ymin, xmin = top-left corner (0-1000), ymax, xmax = bottom-right corner (0-1000).
- Transcribe original_text first to ensure precise bounding box position.
- Do NOT wrap in markdown, commentary, or explanation. JSON only.`;

  const modelsToTry = [
    settings.modelPreference === "auto" ? "gemini-3.5-flash-lite" : settings.modelPreference,
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3-flash",
    "gemini-2.5-flash"
  ];
  // Remove duplicates while preserving order
  const uniqueModels = [...new Set(modelsToTry)];

  let lastError = "";

  for (const model of uniqueModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const payload = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        safetySettings: [
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        generationConfig: {
          response_mime_type: "application/json"
        }
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
          console.warn(`Model ${model} hit 429 Quota Exceeded. Trying fallback model...`);
          lastError = "API Quota Exceeded";
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("No output from Gemini API");

      const cleanJson = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsed = SuperKServer.parseResult(cleanJson);

      if (!parsed || !Array.isArray(parsed.bubbles)) {
        throw new Error("Invalid response format from AI");
      }

      return parsed;
    } catch (e) {
      console.warn(`Failed with model ${model}:`, e);
      lastError = e.message;
    }
  }

  throw new Error(`การแปลล้มเหลว: ${lastError}`);
}

let lastPublishSyncTime = 0;

async function checkPublishedUpdates() {
  try {
    const stored = await chrome.storage.sync.get({ serverUrl: "http://127.0.0.1:3000" });
    const since = lastPublishSyncTime || (Date.now() - 60000);
    const url = `${stored.serverUrl}/api/extension/publish-back?since=${since}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data.updates) && data.updates.length > 0) {
      for (const update of data.updates) {
        if (!lastPublishSyncTime || update.updatedAt > lastPublishSyncTime) {
          lastPublishSyncTime = update.updatedAt;
        }

        // 1. Update cache in extension local storage
        const storageKey = `superk_trans_${update.pageUrl}`;
        await chrome.storage?.local?.set?.({
          [storageKey]: {
            imageUrl: update.pageUrl,
            bubbles: update.bubbles,
            cleanMode: "inpainting",
            cleanImageBase64: update.cleanUrl || null,
            textStyle: update.textStyle,
            timestamp: update.updatedAt || Date.now(),
          },
        })?.catch?.(() => {});

        // 2. Broadcast to tabs
        if (chrome.tabs?.query) {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (tab.id != null) {
              chrome.tabs.sendMessage(tab.id, {
                action: "UPDATE_OVERLAY",
                pageUrl: update.pageUrl,
                originUrl: update.originUrl,
                bubbles: update.bubbles,
                textStyle: update.textStyle,
                cleanUrl: update.cleanUrl,
              }).catch(() => {});
            }
          }
        }
      }
      return data.updates;
    }
    return [];
  } catch {
    return [];
  }
}

if (typeof setInterval === "function") {
  setInterval(checkPublishedUpdates, 3000);
}

if (typeof globalThis !== "undefined") {
  globalThis.checkPublishedUpdates = checkPublishedUpdates;
}
