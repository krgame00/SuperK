# Clean First and Mask Editing Implementation Plan

**Goal:** Implement the approved clean-first workflow and simplify mask correction.

**Architecture:** Explicit all-text mode across client/API/jobs/pipeline; preserve safe legacy jobs. Extend metadata/cache identity. Refine existing MaskEditor and retain its authorization/undo mechanisms.

- [x] Backend: failing tests; mode schema/form validation, job metadata/recovery, pipeline all-text eligibility and quality candidate retention, retry consistency.
- [x] Frontend integration: failing tests; send all-text mode, decode/persist/restore mode, invalidate safe cache reuse, allow translation with visible all-text review flags.
- [x] Editor: failing interaction tests; Thai primary tools, progressive disclosure, original/clean comparison, selected region fit, apply without closing and next navigation.
- [x] Independent spec/quality review; fix findings and run meaningful full gates.
- [x] Restore production build and hidden launcher after the approved restart; verify health. Report any remaining real-image verification limits. Do not commit/push without a new request.

Verification: full Vitest 1,138 passed / 1 skipped before the final erase-all follow-up; affected integration/editor suites rerun after that change: 98 passed. Backend 217 passed / 3 model tests deselected; Ruff passed. TypeScript and final production build passed. Full ESLint: no errors, 51 warnings (including one temporary preview fixture warning). Independent review findings about partial restore and erase-all were fixed and rechecked. Desktop and 390px mobile UI checked using synthetic fixture; apply stays open and selected region fits. Detector reported one contrast warning for near-black text on bright cyan; screenshot inspection showed readable contrast, so retained existing treatment. Real source-page/model cleaning quality remains unverified; OCR may miss glyphs requiring manual mask correction.

Production rebuilt, assets synchronized, and launched through SuperK-Production.vbs. Web 3000 and OCR 8765/health both returned HTTP 200. No commit or push performed.

Pre-commit verification after user requested commit/push: complete Vitest 1,139 passed / 1 skipped; backend 217 passed / 3 model tests deselected; staged whitespace check passed. Remote main was synchronized before commit.
