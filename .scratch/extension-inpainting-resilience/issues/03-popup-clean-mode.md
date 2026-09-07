# 03: Popup Clean Mode UI & Server Settings Synchronization

**What to build:** The extension popup UI exposes "Inpainting (Recommended)" as the default cleaning mode, alongside "Solid" and "Stroke". The extension synchronizes its active `cleanMode` directly from the SuperK server settings and stores it in `chrome.storage.sync` so that users do not lose their inpainting preferences when saving popup settings.

**Blocked by:** 02: Strict Fail-Loud Invariant & Actionable Retry UI

**Status:** done

- [x] `popup.html` offers `<option value="inpainting" selected>ลบข้อความต้นฉบับเนียนกริบ (Inpainting - แนะนำ)</option>`.
- [x] `popup.js` recognizes `inpainting` and defaults to it on fresh install or unset configuration.
- [x] `background.js` synchronizes `cleanMode` from SuperK server settings as priority over stale storage.
- [x] High-resolution SuperK branding icons are packaged with the extension.
