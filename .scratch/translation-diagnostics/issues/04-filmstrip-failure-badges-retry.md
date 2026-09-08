# 04: Filmstrip Failure Badges & Targeted Page Retry

**What to build:** Translators can visually see which manga pages failed on the page thumbnail filmstrip through clear warning badges. Hovering or clicking on a badge displays a brief tooltip indicating the failure cause. An explicit "ลองแปลใหม่เฉพาะหน้าที่ไม่ผ่าน" (Retry Failed Pages) button allows translators to re-run only the failed pages without wasting time or quota on already translated pages.

**Blocked by:** 02: Structured Translation Error Taxonomy & API Contract, 03: Translation Diagnostic Modal & Action Matrix

**Status:** ready-for-agent

- [ ] `PageFilmstrip` displays an amber/red warning icon badge on the thumbnail of any page currently listed in `batchFailures`
- [ ] Hovering over the failure badge reveals a tooltip with the specific Thai diagnostic reason
- [ ] The workspace toolbar displays a "ลองใหม่เฉพาะหน้าที่ตกหล่น" button whenever failures exist
- [ ] Clicking retry selectively passes only the failed page indices to `handleTranslateAll`, preserving already completed pages
- [ ] As pages successfully translate upon retry, their warning badges clear automatically
- [ ] Tests verify badge rendering on failed pages and verify that successful retries clear the badges
