# Auto Source Fill Implementation Plan

**Goal:** Preserve admitted original fill colors in Auto as selected by the user.

**Architecture:** One bounded rule in existing shared resolver; retain fallback and ownership priority. Existing rendering/export callers consume the rule.

- [x] Add failing regressions for admitted red/cyan/orange/outlined and no-outline source color, threshold, rejected, manual/readable, and disabled matching.
- [x] Implement evidence-gated original fill preservation before automatic readability adaptation. Update tests for the explicitly replaced white-fill rule.
- [x] Add render-policy migration for persisted images; reproduce and fix stale-cache resurrection in full and incremental saves.
- [x] Run color matching/export regression gates, TypeScript/ESLint, independent review, and rerun actual crop comparison.
- [x] Record limitations and report usage; no commit/push or service restart without current authorization.

Verification: affected color/export/storage/restore/autosave suites passed 323 tests in 46 files. After the independent reviewer identified the full-save migration edge, a new failing regression reproduced it; the revised focused storage/resolver suites passed 32 tests, independently confirmed by the reviewer. TypeScript passed; targeted ESLint had no errors and two existing unused-variable warnings. Independent final review found no remaining concrete issues.

Real-source comparison reran the existing extractor/shared resolver on 12 text crops from pages 3, 4 and 7. Auto fill now matches the extracted original fill in all 12 samples. This verifies preservation, not exact extraction accuracy or all 33 archive pages. Gradient and borderless admitted subtitle behavior have regression coverage. Some existing extraction profiles still invent white outlines; that separate limitation remains.

Local visual before/after evidence: `.scratch/text-color-experiment/real-comparison.png`; original baseline retained in `real-baseline-before.json`.

User authorized immediate service update. Stopped only the verified owned web process, completed Next production build successfully, synced standalone assets, and relaunched through hidden Production VBS. Web and OCR health both returned HTTP 200. Build ID: `qOqEqIHdf5VuVpPyOiwku`. No commit or push performed.
