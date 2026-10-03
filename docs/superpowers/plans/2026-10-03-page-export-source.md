# Per-page export source implementation plan

> **For agentic workers:** Use subagent-driven-development for implementation and independent review.

**Goal:** Select translated, original or clean content per image and honor it across exports.

**Architecture:** Store optional source metadata on page objects and saved sessions. Resolve explicit source before translated cache/render paths. Keep existing translated review safeguards, select relevant review checks for other sources.

**Tech Stack:** React, TypeScript, IndexedDB, Vitest, existing canvas/JSZip/PDF export.

## Constraints

Preserve existing dirty work. No provider calls or runtime restart. Read installed Next docs before framework edits. No commit/push requested for this task.

### Task 1: Implement complete per-page export selection

Files: src/app/page.tsx, hooks/useTranslation.ts, lib/projectStore.ts, lib/export/pageSource.ts, relevant workspace components; tests/export, tests/cleaning/projectStore.test.ts, tests/workflow/WorkspacePage.test.tsx.

- [x] Add failing tests: select original for blank page, clean unavailable fails, mixed pages use correct content, choice survives project roundtrip and navigation; original bypasses semantic/readability gates.
- [x] Run tests with `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run` and observe expected failures.
- [x] Implement `type PageExportSource = "translated" | "original" | "clean"`; normalize absent/invalid source to translated. Track optional `exportSource` per page, propagate `pageExportSources` to useTranslation save metadata. Preserve on storage write/load/migration.
- [x] Add native per-page select with Thai labels. Allow single-image export for explicit original even without bubbles. Disable unavailable clean option and changes while exporting.
- [x] Resolve selected original/clean URLs before translated render/cache. Convert blobs to data URLs when required; preserve raw bytes and correct MIME extensions in image/ZIP/CBZ. Missing selected asset fails visibly.
- [x] Route review/readability checks according to selected sources; translated keeps current guards, clean keeps cleaning review, original has no derived-image review. Freeze selected sources across asynchronous export/confirmation.
- [x] Run focused export/workflow/persistence tests, TypeScript and changed-file ESLint.

### Task 2: Independent review and regression verification

- [x] Review actual task diff against the design, especially mixed formats, source choice persistence, stale confirmations and missing clean assets.
- [x] Fix material findings and rerun focused tests.
- [x] Run regression suites covering prior clean-ahead and current export workflows; record evidence here.
- [x] Report code completion and runtime deployment status accurately. Restart only after user confirms saved-work timing.

## Completion evidence — 2026-10-03

- Implemented selector near the current image, optional page source metadata, source-only autosave, project roundtrip and source-specific review/report routing.
- Single image, ZIP and CBZ preserve selected original/clean bytes and actual MIME extensions. PDF/strip resolve the same per-page selection; strip awaits every save before unlocking.
- Export snapshots lock selection/navigation until completion or cancellation. Independent review caught a manual-report lock bypass; corrected and verified with a deferred-fetch regression.
- Root verification: 33 files / 302 tests passed using Vitest for translation hooks, cleaning hooks/client/storage, workflow, workspace and export suites.
- Root TypeScript check passed. Changed-file ESLint: zero errors, seven existing warnings.
- Independent final review: spec pass, quality approved. Nine targeted workflow tests passed on re-review, including cancellation, early continuation and deferred-save locking.
- All fixtures synthetic; no provider requests, commits or push. Runtime build/restart awaiting user's saved-work timing confirmation; clean-ahead code will be included in the same update.

## Runtime update — 2026-10-03

User confirmed work saved. Next production build passed (exit 0), standalone assets synced, web and OCR started with hidden windows. Verified HTTP 200 from web and OCR health. Served HTML contains current build `w72WfLONVOVA59g9iOCJL`. Web PID 18480; OCR server PID 6052 (launcher PID 26976). This build includes clean-ahead and per-page export source selection. No provider requests, commits or push.
