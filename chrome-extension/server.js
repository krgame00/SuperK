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

  async translate(image, settings) {
    const base = this.normalizeUrl(settings.serverUrl);
    let response;
    try {
      response = await fetch(`${base}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: image.base64, mimeType: image.mimeType,
          targetLang: settings.targetLang, sourceLang: settings.sourceLang,
          modelPreference: settings.modelPreference,
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

  _cachedSettings: null,
  _cacheTimestamp: 0,
  CACHE_TTL_MS: 30000,

  async fetchSettings(rawServerUrl) {
    const now = Date.now();
    if (this._cachedSettings && (now - this._cacheTimestamp) < this.CACHE_TTL_MS) {
      return { ...this._cachedSettings, isOfflineFallback: false };
    }

    const defaultFallback = {
      geminiApiKey: '',
      modelPreference: 'auto',
      modelHierarchy: [
        'gemini-3.5-flash-lite',
        'gemini-3.6-flash',
        'gemini-3-flash',
        'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
      ],
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

    let serverUrl = 'http://127.0.0.1:3000';
    try {
      serverUrl = this.normalizeUrl(rawServerUrl || 'http://127.0.0.1:3000');
    } catch {
      // Keep default
    }

    try {
      const response = await fetch(`${serverUrl}/api/extension/settings`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
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
      this._cachedSettings = mergedSettings;
      this._cacheTimestamp = now;

      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ superk_cached_settings: mergedSettings }).catch(() => {});
      }

      return { ...mergedSettings, isOfflineFallback: false };
    } catch {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
        try {
          const stored = await chrome.storage.local.get('superk_cached_settings');
          if (stored?.superk_cached_settings) {
            return {
              ...defaultFallback,
              ...stored.superk_cached_settings,
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
