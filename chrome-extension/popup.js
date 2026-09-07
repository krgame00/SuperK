document.addEventListener('DOMContentLoaded', async () => {
  const ids = ['translationMode', 'serverUrl', 'apiKey', 'targetLang', 'modelPreference', 'cleanMode'];
  const fields = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const status = document.getElementById('statusBadge');
  const save = document.getElementById('btnSave');
  function report(text, error = false) {
    status.textContent = text;
    status.className = error ? 'status-warn' : 'status-ready';
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
    const settings = await chrome.storage.sync.get({ translationMode: 'server',
      serverUrl: 'http://127.0.0.1:3000', apiKey: '', targetLang: 'Thai',
      modelPreference: 'auto', cleanMode: 'inpainting' });
    if (!['inpainting', 'solid', 'stroke'].includes(settings.cleanMode)) settings.cleanMode = 'inpainting';
    for (const id of ids) fields[id].value = settings[id];
    updateMode();
  } catch { report('โหลดการตั้งค่าไม่ได้ กรุณาปิดแล้วเปิดส่วนเสริมอีกครั้ง', true); }
  fields.translationMode.addEventListener('change', updateMode);
  document.getElementById('settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      const settings = Object.fromEntries(ids.map(id => [id, fields[id].value.trim()]));
      if (settings.translationMode === 'server') settings.serverUrl = SuperKServer.normalizeUrl(settings.serverUrl);
      if (settings.translationMode === 'direct' && !settings.apiKey) throw new Error('กรุณากรอก Gemini API Key');
      await chrome.storage.sync.set(settings);
      report('บันทึกแล้ว คลิกขวาที่ภาพเพื่อเริ่มแปล');
    } catch (error) { report(error.message || 'บันทึกไม่ได้ กรุณาลองใหม่', true); }
    finally { save.disabled = false; }
  });
  document.getElementById('btnOpen').addEventListener('click', async () => {
    try { await chrome.tabs.create({ url: SuperKServer.normalizeUrl(fields.serverUrl.value) }); }
    catch (error) { report(error.message, true); }
  });
});
