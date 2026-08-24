# SuperK Chrome Extension

Browser companion for the SuperK Manga Translator web app.

## Install (unpacked)

1. Build/start the web app (`npm run dev` → `http://localhost:3000`).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this `chrome-extension/` folder.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest, permissions + content script registration |
| `background.js` | Service worker (message routing) |
| `content.js` / `content.css` | Injected page integration |
| `popup.html` / `popup.js` | Toolbar popup UI |
