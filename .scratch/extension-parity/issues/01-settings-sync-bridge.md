# 01: Settings Synchronization Bridge

**What to build:** The extension automatically detects and synchronizes settings with the running SuperK instance via a localhost bridge endpoint (`/api/extension/settings`). It inherits active Gemini API keys, model priority tiers, glossary rules, and font/typography preferences without requiring duplicate manual configuration in extension settings. When SuperK is offline, it falls back gracefully to cached settings in extension local storage.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `/api/extension/settings` endpoint serves current SuperK settings restricted to localhost requests with origin verification.
- [x] Extension background worker fetches settings from SuperK with a 30-second in-memory cache.
- [x] Extension falls back to stored extension local cache when SuperK is unreachable, displaying an indicator badge.
- [x] Integration test verifies settings contract, caching behavior, and network fallback.
