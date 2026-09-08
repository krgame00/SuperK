# 04: Preserved Reading-Site Metadata & Handoff Data URL Persistence (P2)

**What to build:** When a translator opens a page for editing from the Chrome extension reading view, the originating manga website URL (`originUrl`) and page metadata are fully preserved through session serialization to and from IndexedDB. Even after browser reloads or days of inactivity, the translator can click "Send back to reading view" to update the reading page. In addition, raw Base64 cleaner assets from the extension are converted into persistent Data URLs so clean artwork survives reload.

**Blocked by:** 02: Monotonic Per-Page Version Tracking & Autosave Concurrency (P1)

**Status:** ready-for-agent

- [ ] Autosave page serialization includes `originUrl` and page metadata alongside image and bubble payloads.
- [ ] Session restoration reconstructs `originUrl` on each loaded page, keeping the "Send back to reading view" button active and visible.
- [ ] Handoff ingestion normalizes incoming raw Base64 cleaner assets into valid Data URLs before saving to `projectStore`.
- [ ] Integration tests in `tests/cleaning/projectStore.test.ts` verify that `originUrl` and clean background Data URLs survive saving and reloading.
