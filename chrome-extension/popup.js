document.addEventListener('DOMContentLoaded', async () => {
  const ids = ['translationMode', 'serverUrl', 'pairingToken', 'apiKey', 'targetLang', 'modelPreference', 'cleanMode'];
  const fields = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  fields.targetLang.textContent = '';
  for (const target of SuperKPolicy.TARGET_LANGUAGES) {
    const option = document.createElement('option'); option.value=target.id; option.textContent=target.label; fields.targetLang.append(option);
  }
  const allowPreview = document.getElementById('allowPreviewModels');
  const refreshModels = document.getElementById('btnRefreshModels');
  const status = document.getElementById('statusBadge');
  const save = document.getElementById('btnSave');

  function report(text, error = false) {
    status.textContent = text;
    status.className = error ? 'status-warn' : 'status-ready';
  }

  function setModelOptions(models, selected) {
    const select = fields.modelPreference;
    select.textContent = '';
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = 'อัตโนมัติ (เลือกจากโมเดลที่ API Key ใช้ได้)';
    select.append(auto);

    const seen = new Set();
    for (const model of models || []) {
      const id = typeof model === 'string' ? model : model?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const option = document.createElement('option');
      option.value = id;
      const preview = typeof model === 'object' && model.releaseChannel === 'preview' ? ' · Preview' : '';
      const keys = typeof model === 'object' && model.availabilityCount
        ? ` · ${model.availabilityCount}/${model.totalKeys || model.availabilityCount} Keys`
        : '';
      option.textContent = `${typeof model === 'object' ? (model.displayName || id) : id}${preview}${keys}`;
      select.append(option);
    }

    if (selected && selected !== 'auto' && !seen.has(selected)) {
      const unavailable = document.createElement('option');
      unavailable.value = selected;
      unavailable.textContent = `${selected} · Unavailable`;
      select.append(unavailable);
    }
    select.value = selected || 'auto';
  }

  async function loadModels(forceReport = true) {
    const selected = fields.modelPreference.value || 'auto';
    refreshModels.disabled = true;
    try {
      if (fields.translationMode.value === 'direct') {
        const routes = await SuperKServer.discoverGeminiRoutes(fields.apiKey.value, {
          modelPreference: 'auto',
          allowPreview: true,
        });
        const models = [];
        const seen = new Set();
        for (const route of routes) {
          if (seen.has(route.model)) continue;
          seen.add(route.model);
          models.push({ id: route.model, displayName: route.model });
        }
        setModelOptions(models, selected);
      } else {
        const synced = await SuperKServer.fetchSettings(fields.serverUrl.value, fields.pairingToken.value);
        setModelOptions(synced.modelCatalog?.models || [], synced.modelPreference || selected);
        if (typeof synced.allowPreviewModels === 'boolean') allowPreview.checked = synced.allowPreviewModels;
      }
      if (forceReport) report('อัปเดตรายการโมเดลแล้ว');
    } catch (error) {
      setModelOptions([], selected);
      if (forceReport) report(error.message || 'โหลดรายการโมเดลไม่ได้', true);
    } finally {
      refreshModels.disabled = false;
    }
  }

  function updateMode() {
    const direct = fields.translationMode.value === 'direct';
    document.getElementById('directSettings').hidden = !direct;
    document.getElementById('serverSettings').hidden = direct;
    fields.serverUrl.disabled = direct;
    fields.serverUrl.required = !direct;
    fields.apiKey.required = direct;
    fields.apiKey.disabled = !direct;
  }

  try {
    const settings = await loadExtensionSettings({
      translationMode: 'server',
      serverUrl: 'http://127.0.0.1:3000',
      pairingToken: '',
      apiKey: '',
      targetLang: 'Thai',
      modelPreference: 'auto',
      allowPreviewModels: false,
      cleanMode: 'inpainting',
    });
    if (!['inpainting', 'solid', 'stroke'].includes(settings.cleanMode)) settings.cleanMode = 'inpainting';
    for (const id of ids) {
      if (id === 'modelPreference') continue;
      fields[id].value = id === "targetLang" ? (SuperKPolicy.createPageTargetIdentity(settings[id])?.targetId || "") : settings[id];
    }
    setModelOptions([], settings.modelPreference || 'auto');
    allowPreview.checked = settings.allowPreviewModels === true;
    updateMode();
    if (settings.translationMode === 'direct' && settings.apiKey) {
      void loadModels(false);
    }
  } catch {
    report('โหลดการตั้งค่าไม่ได้ กรุณาปิดแล้วเปิดส่วนเสริมอีกครั้ง', true);
  }

  fields.translationMode.addEventListener('change', () => {
    updateMode();
    if (fields.translationMode.value === 'direct' && fields.apiKey.value) void loadModels(false);
  });
  refreshModels.addEventListener('click', () => void loadModels(true));

  document.getElementById('settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      const settings = Object.fromEntries(ids.map(id => [id, fields[id].value.trim()]));
      if (!SuperKPolicy.createPageTargetIdentity(settings.targetLang)) throw new Error("Choose a supported target writing system");
      settings.allowPreviewModels = allowPreview.checked;
      if (settings.translationMode === 'server') settings.serverUrl = SuperKServer.normalizeUrl(settings.serverUrl);
      if (settings.translationMode === 'direct' && !settings.apiKey) throw new Error('กรุณากรอก Gemini API Key');
      // The pairing token is a local secret — it must never return to
      // chrome.storage.sync.
      const { pairingToken, ...syncSettings } = settings;
      await chrome.storage.sync.set(syncSettings);
      try {
        if (pairingToken) await chrome.storage.local.set({ pairingToken });
        else await chrome.storage.local.remove('pairingToken');
      } catch {
        // No local storage access — keep the legacy sync write so the token
        // is not lost; the next read migrates it back to local.
        await chrome.storage.sync.set({ pairingToken });
      }
      report('บันทึกแล้ว คลิกขวาที่ภาพเพื่อเริ่มแปล');
    } catch (error) {
      report(error.message || 'บันทึกไม่ได้ กรุณาลองใหม่', true);
    } finally {
      save.disabled = false;
    }
  });

  document.getElementById('btnOpen').addEventListener('click', async () => {
    try {
      await chrome.tabs.create({ url: SuperKServer.normalizeUrl(fields.serverUrl.value) });
    } catch (error) {
      report(error.message, true);
    }
  });
});
