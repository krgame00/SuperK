# 04: Direct Mode Isolation & Offline Resilience

**What to build:** When a reader selects direct translation mode with their own Gemini API key (`translationMode: "direct"`), the extension translates directly with Gemini without attempting to contact the local SuperK inpainting server or cleaner endpoints, preventing connection errors when SuperK is not running. When the SuperK server is offline in server mode, the extension safely falls back to stored preferences.

**Blocked by:** 03: Popup Clean Mode UI & Server Settings Synchronization

**Status:** done

- [x] In `translationMode: "direct"`, `background.js` does not call `SuperKServer.fetchSettings` or `SuperKServer.inpaintImage`.
- [x] Direct mode translates image and returns overlays without requiring a running SuperK backend.
- [x] When the server is offline (`isOfflineFallback: true`), stored user `cleanMode` preferences are preserved.
- [x] Automated tests verify direct mode isolation and offline fallback behavior.
