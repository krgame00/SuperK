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
      apiKey: "", pairingToken: "", targetLang: "Thai", sourceLang: "auto",
      modelPreference: "auto", allowPreviewModels: false, cleanMode: "inpainting"
    });
    const synced = stored.translationMode === "direct"
      ? {}
      : await SuperKServer.fetchSettings(stored.serverUrl, stored.pairingToken).catch(() => ({}));
    const settings = {
      ...stored,
      ...synced,
      pairingToken: stored.pairingToken || "",
      apiKey: stored.apiKey || "",
      modelPreference: stored.translationMode === "server" && synced.modelPreference
        ? synced.modelPreference
        : (stored.modelPreference || "auto"),
      allowPreviewModels: stored.translationMode === "server" && typeof synced.allowPreviewModels === "boolean"
        ? synced.allowPreviewModels
        : stored.allowPreviewModels === true,
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
  const apiKeyRaw = String(settings.apiKey || '').trim();
  if (!apiKeyRaw) {
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

  const routes = SuperKServer.getDirectExecutionRoutes(apiKeyRaw, {
    modelPreference: settings.modelPreference || "auto",
  });

  const totalBudgetMs = 180000;
  const startTime = Date.now();
  let lastError = "";

  for (const route of routes) {
    const elapsed = Date.now() - startTime;
    const remaining = totalBudgetMs - elapsed;
    if (remaining <= 0) {
      lastError = "หมดเวลางบประมาณการแปล (Total Timeout Exhausted)";
      break;
    }
    const attemptTimeout = Math.min(60000, remaining);
    const model = route.model;

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
          "x-goog-api-key": route.apiKey
        },
        signal: AbortSignal.timeout(attemptTimeout),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
          console.warn(`Model ${model} hit 429 Quota Exceeded. Trying fallback model...`);
          lastError = "API Quota Exceeded";
          continue;
        }
        if (res.status === 404) {
          console.warn(`Model ${model} returned 404 Not Found. Trying fallback model...`);
          lastError = `Model ${model} Not Found`;
          continue;
        }
        if (res.status >= 500 && res.status < 600) {
          console.warn(`Model ${model} hit server error ${res.status}. Trying fallback model...`);
          lastError = `Server Error HTTP ${res.status}`;
          continue;
        }
        if (res.status === 400 && /safety/i.test(errText)) {
          throw new Error(`คำขอนี้ถูกระงับโดยตัวกรองความปลอดภัยของ Google (Safety Filter)`);
        }
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason === "SAFETY") {
        throw new Error(`คำขอนี้ถูกระงับโดยตัวกรองความปลอดภัยของ Google (Safety Filter)`);
      }
      const text = candidate?.content?.parts?.[0]?.text;
      if (!text) {
        if (data.promptFeedback?.blockReason) {
          throw new Error(`ภาพถูกบล็อกโดยตัวกรองความปลอดภัยของ Google (Safety Filter): ${data.promptFeedback.blockReason}`);
        }
        throw new Error("No output from Gemini API");
      }

      const cleanJson = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsed = SuperKServer.parseResult(cleanJson);

      if (!parsed || !Array.isArray(parsed.bubbles)) {
        throw new Error("Invalid response format from AI");
      }

      return parsed;
    } catch (e) {
      if (e.message?.includes("ตัวกรองความปลอดภัย") || e.message?.includes("Safety Filter")) {
        throw e;
      }
      console.warn(`Failed with model ${model}:`, e);
      lastError = e.message;
      if (Date.now() - startTime >= totalBudgetMs) {
        break;
      }
    }
  }

  throw new Error(`การแปลล้มเหลว: ${lastError}`);
}

function normalizeServerUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "http://127.0.0.1:3000";
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

async function getSyncCursor(normalizedUrl) {
  const storageKey = `superk_sync_cursor_${encodeURIComponent(normalizedUrl)}`;
  try {
    const res = await chrome.storage?.local?.get?.(storageKey);
    if (res && res[storageKey]) {
      return { ...res[storageKey] };
    }
  } catch {
    // fallback
  }
  return {
    serverUrl: normalizedUrl,
    epoch: "",
    seq: 0,
    lastSyncTime: 0,
  };
}

async function saveSyncCursor(normalizedUrl, cursor) {
  const storageKey = `superk_sync_cursor_${encodeURIComponent(normalizedUrl)}`;
  try {
    await chrome.storage?.local?.set?.({ [storageKey]: cursor });
  } catch (e) {
    console.warn("Failed to persist sync cursor:", e);
  }
}

let isSyncInProgress = false;

async function checkPublishedUpdates() {
  if (isSyncInProgress) return [];
  isSyncInProgress = true;
  try {
    const stored = (await chrome.storage?.sync?.get?.({ serverUrl: "http://127.0.0.1:3000" })) || {
      serverUrl: "http://127.0.0.1:3000",
    };
    const normalizedUrl = normalizeServerUrl(stored.serverUrl);
    let cursor = await getSyncCursor(normalizedUrl);

    let query = "";
    if (cursor.epoch) {
      query = `sinceSeq=${cursor.seq}&sinceEpoch=${encodeURIComponent(cursor.epoch)}`;
    } else if (cursor.seq > 0) {
      query = `sinceSeq=${cursor.seq}`;
    } else if (cursor.lastSyncTime > 0) {
      query = `since=${cursor.lastSyncTime}`;
    } else {
      query = `since=${Date.now() - 60000}`;
    }

    const url = `${normalizedUrl}/api/extension/publish-back?${query}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json();

    const serverEpoch = data.epoch;
    if (serverEpoch && cursor.epoch && cursor.epoch !== serverEpoch) {
      console.warn(`Server epoch changed from ${cursor.epoch} to ${serverEpoch}. Resetting sync cursor.`);
      cursor.epoch = serverEpoch;
      cursor.seq = 0;
      cursor.lastSyncTime = 0;
      await saveSyncCursor(normalizedUrl, cursor);
    } else if (serverEpoch && !cursor.epoch) {
      cursor.epoch = serverEpoch;
      await saveSyncCursor(normalizedUrl, cursor);
    }

    if (Array.isArray(data.updates) && data.updates.length > 0) {
      const sortedUpdates = [...data.updates].sort((a, b) => {
        if (a.seq != null && b.seq != null) return a.seq - b.seq;
        return (a.updatedAt || 0) - (b.updatedAt || 0);
      });

      const processedUpdates = [];

      for (const update of sortedUpdates) {
        if (update.seq != null && update.seq <= cursor.seq) {
          continue; // Skip duplicate or already synced publication snapshot
        }

        try {
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
          });

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

          // 3. ONLY after step 1 and step 2 complete successfully:
          if (update.seq != null && update.seq > cursor.seq) {
            cursor.seq = update.seq;
          }
          if (update.updatedAt && update.updatedAt > (cursor.lastSyncTime || 0)) {
            cursor.lastSyncTime = update.updatedAt;
          }
          await saveSyncCursor(normalizedUrl, cursor);
          processedUpdates.push(update);
        } catch (itemErr) {
          console.warn("Failed to process publish-back update, keeping cursor at last success:", itemErr);
          break; // Don't advance cursor past failed item; retry next poll
        }
      }
      return processedUpdates;
    }
    return [];
  } catch {
    return [];
  } finally {
    isSyncInProgress = false;
  }
}

if (typeof setInterval === "function") {
  setInterval(checkPublishedUpdates, 3000);
}

if (typeof globalThis !== "undefined") {
  globalThis.normalizeServerUrl = normalizeServerUrl;
  globalThis.getSyncCursor = getSyncCursor;
  globalThis.saveSyncCursor = saveSyncCursor;
  globalThis.checkPublishedUpdates = checkPublishedUpdates;
}
