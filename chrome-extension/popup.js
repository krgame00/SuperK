// SuperK Manga Translator - Popup Logic

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyEl = document.getElementById('apiKey');
  const targetLangEl = document.getElementById('targetLang');
  const modelPreferenceEl = document.getElementById('modelPreference');
  const cleanModeEl = document.getElementById('cleanMode');
  const hfTokenEl = document.getElementById('hfToken');
  const customInpaintUrlEl = document.getElementById('customInpaintUrl');
  const btnSave = document.getElementById('btnSave');
  const statusBadge = document.getElementById('statusBadge');

  // Load saved settings
  const settings = await chrome.storage.sync.get({
    apiKey: '',
    targetLang: 'Thai',
    modelPreference: 'gemini-3.5-flash-lite',
    cleanMode: 'auto',
    hfToken: 'hf_<REMOVED>',
    customInpaintUrl: ''
  });

  apiKeyEl.value = settings.apiKey;
  targetLangEl.value = settings.targetLang;
  modelPreferenceEl.value = settings.modelPreference;
  cleanModeEl.value = settings.cleanMode;
  if (hfTokenEl) hfTokenEl.value = settings.hfToken || 'hf_<REMOVED>';
  if (customInpaintUrlEl) customInpaintUrlEl.value = settings.customInpaintUrl || '';

  updateStatus(settings.apiKey);

  // Save settings
  btnSave.addEventListener('click', async () => {
    const apiKey = apiKeyEl.value.trim();
    const targetLang = targetLangEl.value;
    const modelPreference = modelPreferenceEl.value;
    const cleanMode = cleanModeEl.value;
    const hfToken = hfTokenEl ? hfTokenEl.value.trim() : '';
    const customInpaintUrl = customInpaintUrlEl ? customInpaintUrlEl.value.trim() : '';

    await chrome.storage.sync.set({
      apiKey,
      targetLang,
      modelPreference,
      cleanMode,
      hfToken,
      customInpaintUrl
    });

    updateStatus(apiKey);

    btnSave.innerHTML = '<span>✅ บันทึกเรียบร้อย!</span>';
    setTimeout(() => {
      btnSave.innerHTML = '<span>💾 บันทึกการตั้งค่า</span>';
    }, 1500);
  });

  function updateStatus(apiKey) {
    if (apiKey) {
      statusBadge.className = 'status-badge status-ready';
      statusBadge.innerHTML = '<span>✅ API Key พร้อมใช้งาน</span>';
    } else {
      statusBadge.className = 'status-badge status-warn';
      statusBadge.innerHTML = '<span>⚠️ กรุณากรอก Gemini API Key</span>';
    }
  }
});
