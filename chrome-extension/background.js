// SuperK Manga Translator - Background Service Worker

// Create context menu on extension install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "superk-translate-image",
    title: "🪄 แปลภาพมังงะด้วย SuperK",
    contexts: ["image"]
  });
});

// Listen for context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "superk-translate-image" && info.srcUrl && tab?.id) {
    const imageUrl = info.srcUrl;
    
    // Notify content script that translation started
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "TRANSLATION_START",
        imageUrl: imageUrl
      });
    } catch (e) {
      console.warn("Content script not ready, injecting...", e);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, {
        action: "TRANSLATION_START",
        imageUrl: imageUrl
      });
    }

    // Get settings from Chrome storage
    const settings = await chrome.storage.sync.get({
      apiKey: "",
      targetLang: "Thai",
      sourceLang: "auto",
      modelPreference: "gemini-3.5-flash-lite"
    });

    try {
      // 1. Fetch image and convert to Base64
      const base64Data = await fetchImageAsBase64(imageUrl);

      // 2. Call Gemini API
      const result = await translateImageWithGemini(base64Data, settings);

      // 3. Send results to content script to overlay
      chrome.tabs.sendMessage(tab.id, {
        action: "TRANSLATION_SUCCESS",
        imageUrl: imageUrl,
        bubbles: result.bubbles,
        targetLang: settings.targetLang
      });

    } catch (err) {
      console.error("SuperK Translation Failed:", err);
      chrome.tabs.sendMessage(tab.id, {
        action: "TRANSLATION_ERROR",
        imageUrl: imageUrl,
        error: err.message || "เกิดข้อผิดพลาดในการแปลภาพ"
      });
    }
  }
});

// Helper: Convert Image URL to Base64
async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helper: Call Gemini API with model rotation & retries
async function translateImageWithGemini(base64Data, settings) {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    throw new Error("กรุณาใส่ Gemini API Key ในเมนู Extension ก่อนใช้งานครับ!");
  }

  const prompt = `You are a professional manga/comic translator. Detect all speech bubbles, text boxes, and floating text in this manga page.
Return ONLY a valid JSON object matching this schema:
{
  "bubbles": [
    {
      "box": [ymin, xmin, ymax, xmax],
      "t": "Translated text in ${settings.targetLang}"
    }
  ]
}
Notes:
- box coordinates must be integers 0-1000 representing normalized box positions [ymin, xmin, ymax, xmax].
- Translate speech bubbles accurately to natural ${settings.targetLang} manga phrasing.
- Do NOT wrap in markdown or commentary, output JSON only.`;

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
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          response_mime_type: "application/json"
        }
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const parsed = JSON.parse(cleanJson);

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
