// Shared by the popup and MV3 service worker; no DOM dependencies.
globalThis.SuperKServer = {
  normalizeUrl(value) {
    let url;
    try { url = new URL(value.trim()); } catch { throw new Error('กรุณาระบุ URL ระบบ SuperK ให้ถูกต้อง'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('ใช้ URL http:// หรือ https:// โดยไม่มีรหัสผ่าน query หรือ #');
    }
    return url.href.replace(/\/+$/, '');
  },

  async blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  },

  parseResult(text) {
    const result = JSON.parse(text.replace(/```json/gi, '').replace(/```/g, '').trim());
    if (!result || !Array.isArray(result.bubbles) || result.bubbles.some(b =>
      !b || typeof b.t !== 'string' || !Array.isArray(b.box) || b.box.length !== 4 ||
      b.box.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000)
    )) throw new Error('ระบบแปลส่งตำแหน่งข้อความไม่ถูกต้อง กรุณาลองใหม่');
    return result;
  },

  splitGeminiKeys(raw) {
    return [...new Set(String(raw || '').split(',').map(key => key.trim()).filter(Boolean))].slice(0, 5);
  },

  isPreviewModel(model) {
    const text = `${model?.id || ''} ${model?.displayName || ''} ${model?.description || ''}`.toLowerCase();
    return /(?:preview|experimental|\bexp\b)/.test(text);
  },

  FIXED_AUTO_MODELS: [
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
  ],

  getDirectExecutionRoutes(rawApiKeys, options = {}) {
    const keys = this.splitGeminiKeys(rawApiKeys);
    if (!keys.length) throw new Error('กรุณาใส่ Gemini API Key ก่อนใช้งาน');
    const modelPreference = options.modelPreference || 'auto';
    const models = (modelPreference !== 'auto' && modelPreference)
      ? [modelPreference]
      : this.FIXED_AUTO_MODELS;

    const routes = [];
    for (const model of models) {
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        routes.push({ model, apiKey: keys[keyIndex], keyIndex });
      }
    }
    return routes;
  },

  async discoverGeminiRoutes(rawApiKeys, options = {}) {
    const keys = this.splitGeminiKeys(rawApiKeys);
    if (!keys.length) throw new Error('กรุณาใส่ Gemini API Key ก่อนใช้งาน');
    const modelPreference = options.modelPreference || 'auto';
    const allowPreview = options.allowPreview === true;
    const byModel = new Map();

    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      const apiKey = keys[keyIndex];
      let pageToken = '';
      do {
        const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: { 'x-goog-api-key': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) break;
          throw new Error(`Gemini model discovery failed (HTTP ${response.status})`);
        }
        const data = await response.json();
        for (const item of Array.isArray(data?.models) ? data.models : []) {
          if (!Array.isArray(item?.supportedGenerationMethods) || !item.supportedGenerationMethods.includes('generateContent')) continue;
          const id = String(item.name || '').replace(/^models\//, '');
          if (!id || !id.startsWith('gemini-')) continue;
          const existing = byModel.get(id) || { id, displayName: item.displayName || id, description: item.description || '', keys: [] };
          existing.keys.push({ apiKey, keyIndex });
          byModel.set(id, existing);
        }
        pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : '';
      } while (pageToken);
    }

    if (modelPreference !== 'auto') {
      const selected = byModel.get(modelPreference);
      if (!selected) throw new Error(`โมเดล ${modelPreference} ไม่พร้อมใช้งานกับ API Key ที่ตั้งไว้`);
      return selected.keys.map(key => ({ model: modelPreference, ...key }));
    }

    const models = [...byModel.values()].filter(model => allowPreview || !this.isPreviewModel(model));
    if (!models.length) throw new Error('ไม่พบ Gemini model ที่รองรับ generateContent สำหรับ API Key นี้');
    return models.flatMap(model => model.keys.map(key => ({ model: model.id, ...key })));
  },

  async translate(image, settings) {
    const base = this.normalizeUrl(settings.serverUrl);
    let response;
    const headers = { 'Content-Type': 'application/json' };
    if (settings.pairingToken) {
      headers['Authorization'] = `Bearer ${settings.pairingToken}`;
      headers['x-superk-pairing-token'] = settings.pairingToken;
    }
    try {
      response = await fetch(`${base}/api/translate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageBase64: image.base64, mimeType: image.mimeType,
          targetLang: settings.targetLang, sourceLang: settings.sourceLang,
          modelPreference: settings.modelPreference,
          apiKey: settings.geminiApiKey || settings.apiKey || '',
          allowPreview: settings.allowPreviewModels === true,
        }),
        signal: AbortSignal.timeout(240000),
      });
    } catch {
      throw new Error('เชื่อมต่อระบบแปลไม่ได้หรือหมดเวลา ตรวจสอบ URL และเปิดระบบ SuperK ไว้');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `ระบบแปลตอบกลับ HTTP ${response.status}`);
    if (typeof data?.text !== 'string') throw new Error('URL นี้ไม่ได้ตอบกลับจาก API แปลของ SuperK');
    return this.parseResult(data.text);
  },

  _cachedSettingsByUrl: new Map(),
  CACHE_TTL_MS: 30000,

  async fetchSettings(rawServerUrl, pairingToken) {
    const now = Date.now();
    let serverUrl = 'http://127.0.0.1:3000';
    try {
      serverUrl = this.normalizeUrl(rawServerUrl || 'http://127.0.0.1:3000');
    } catch {
      // Keep default
    }

    const cachedEntry = this._cachedSettingsByUrl?.get(serverUrl);
    if (cachedEntry && (now - cachedEntry.timestamp) < this.CACHE_TTL_MS) {
      return { ...cachedEntry.settings, isOfflineFallback: false };
    }

    const defaultFallback = {
      geminiApiKey: '',
      modelPreference: 'auto',
      // Compatibility field only; dynamic discovery is the source of truth.
      modelHierarchy: [],
      allowPreviewModels: false,
      glossary: [],
      textStyle: {
        fontFamily: 'Itim, sans-serif',
        fontSizeMultiplier: 1.0,
        textColor: '#000000',
        textOutline: '#FFFFFF',
      },
      ocrServiceUrl: 'http://127.0.0.1:8765',
      targetLang: 'Thai',
      sourceLang: 'auto',
      cleanMode: 'inpainting',
    };

    const storageKey = `superk_cached_settings_${encodeURIComponent(serverUrl)}`;

    try {
      const headers = { Accept: 'application/json' };
      if (pairingToken) {
        headers['Authorization'] = `Bearer ${pairingToken}`;
        headers['x-superk-pairing-token'] = pairingToken;
      }
      const response = await fetch(`${serverUrl}/api/extension/settings`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid settings JSON');
      }

      const mergedSettings = { ...defaultFallback, ...data };
      if (!this._cachedSettingsByUrl) {
        this._cachedSettingsByUrl = new Map();
      }
      this._cachedSettingsByUrl.set(serverUrl, { settings: mergedSettings, timestamp: now });

      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ [storageKey]: mergedSettings }).catch(() => {});
      }

      return { ...mergedSettings, isOfflineFallback: false };
    } catch {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
        try {
          const stored = await chrome.storage.local.get(storageKey);
          if (stored?.[storageKey]) {
            return {
              ...defaultFallback,
              ...stored[storageKey],
              isOfflineFallback: true,
            };
          }
        } catch {
          // Ignore
        }
      }

      return {
        ...defaultFallback,
        isOfflineFallback: true,
      };
    }
  },

  async inpaintImage(image, settings) {
    let base = 'http://127.0.0.1:3000';
    try {
      base = this.normalizeUrl(settings?.serverUrl || 'http://127.0.0.1:3000');
    } catch {
      // Keep default
    }

    const binary = atob(image.base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    const blob = new Blob([array], { type: image.mimeType || 'image/png' });

    const formData = new FormData();
    formData.append('image', blob, 'manga.png');

    let postRes;
    try {
      postRes = await fetch(`${base}/api/clean/v1/jobs`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error('ไม่สามารถเชื่อมต่อ Inpainting Engine ได้ กรุณาเปิดระบบ SuperK ไว้');
    }

    if (!postRes.ok) {
      throw new Error(`Inpainting Engine ตอบกลับข้อผิดพลาด (HTTP ${postRes.status})`);
    }

    const jobData = await postRes.json();
    const jobId = jobData.job_id || jobData.jobId;
    if (!jobId) {
      throw new Error('ไม่ได้รับ Job ID จากระบบคลีน');
    }

    const startTime = Date.now();
    let status = jobData.status;
    while (status === 'queued' || status === 'running' || status === 'detecting' || status === 'cleaning') {
      if (Date.now() - startTime > 120000) {
        throw new Error('Inpainting หมดเวลา (Timeout)');
      }
      await new Promise(r => setTimeout(r, 500));
      const pollRes = await fetch(`${base}/api/clean/v1/jobs/${encodeURIComponent(jobId)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!pollRes.ok) throw new Error('เกิดข้อผิดพลาดระหว่างตรวจสอบสถานะ Inpainting');
      const pollData = await pollRes.json();
      status = pollData.status;
      if (status === 'failed' || status === 'error') {
        throw new Error(pollData.error || 'การลบข้อความต้นฉบับ (Inpainting) ล้มเหลว');
      }
    }

    const resultRes = await fetch(`${base}/api/clean/v1/jobs/${encodeURIComponent(jobId)}/result`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!resultRes.ok) throw new Error('ไม่สามารถดาวน์โหลดผลลัพธ์ภาพที่คลีนแล้วได้');
    const resultData = await resultRes.json();

    const cleanAssetPath = resultData.clean_asset || resultData.cleanAsset;
    let cleanImageBase64 = '';
    if (cleanAssetPath) {
      let assetUrl = cleanAssetPath;
      if (!assetUrl.startsWith('http')) {
        const cleanPathNormalized = cleanAssetPath.startsWith('/api/clean')
          ? cleanAssetPath
          : `/api/clean${cleanAssetPath.startsWith('/') ? '' : '/'}${cleanAssetPath}`;
        assetUrl = `${base}${cleanPathNormalized}`;
      }
      const assetRes = await fetch(assetUrl, { signal: AbortSignal.timeout(30000) });
      if (!assetRes.ok) {
        throw new Error(`ไม่สามารถดาวน์โหลดไฟล์ภาพที่ลบข้อความแล้วได้ (HTTP ${assetRes.status})`);
      }
      const assetBlob = await assetRes.blob();
      cleanImageBase64 = await this.blobToBase64(assetBlob);
    }

    if (!cleanImageBase64) {
      throw new Error('ไม่ได้รับข้อมูลภาพที่ลบข้อความแล้ว (cleanImageBase64) จากระบบ Inpainting');
    }

    return {
      jobId,
      cleanImageBase64,
      cleanMimeType: 'image/png',
    };
  },
};
