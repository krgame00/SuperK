# Continuous cleaning ahead of translation

Approved user behavior: clean subsequent pages continuously while waiting for translation and display finished clean images immediately.

1. A serial cleaning producer runs independently of the serial translation consumer. Start first page on demand, then keep at most three future preparation outcomes buffered (including the in-flight job) to bound pending work. Completed cleaning assets use existing persistence and resource ownership. Selected retry work only; never clean completed/excluded pages.
2. The producer stops scheduling on cancellation, quota/fatal batch exit and normal completion. Pass an optional AbortSignal through preparation and cleanPage; late responses cannot commit a cancelled job. Catch failures as per-page outcomes, keep successful clean images even when translation fails.
3. Show cleaned backgrounds as soon as ready in translated view, including the current single-page operation. Preserve an explicit switch to Original while work runs; completion must not forcibly switch it back. Expose live cleaning progress separately from translation.
4. Tests: blocked first translation while pages 2 and3 finish cleaning; one cleaner at a time; bounded queue; ordered translation; cancellation/late completion; quota; page failure isolation; clean image visible while translation pending; saved assets retained.

Preserve current dirty color/review/drag work and AI-WORKING-NOTES. No real provider calls. No commit/push. Production update only after tested and saved-work timing is confirmed.

## Progress

- [x] Serial producer, three future outcomes, production default, ordered consumer.
- [x] Optional abort signal through image preparation, cleaner requests/polling/asset hydration, late-result publication guards.
- [x] Immediate clean preview and preservation of a user-selected Original/Clean view.
- [x] Focused verification: 247 tests across 30 files passed; TypeScript passed; ESLint zero errors/eight existing warnings.
- [x] Resolve independent review findings: restore suppression is page-specific, retries after operation completion/cancel, and releases every successful background page including clean-only results.
- [x] Final review: reviewer independently passed 39 hook tests and approved with no remaining blocking findings.
- [ ] Production update after saved-work timing approval.

## Runtime update — 2026-10-03

Deployed together with per-page export selection after user's saved-work confirmation. Production build passed; served build `w72WfLONVOVA59g9iOCJL` verified against web HTML. Web and OCR health both HTTP 200. Combined regression: 33 files / 302 tests passed before deployment. No provider calls, commit or push.
