# Foreign Script Guard Implementation Plan

> **For agentic workers:** Use executing-plans to implement this approved plan inline, task by task.

**Goal:** Catch foreign lettering in Thai translations, retry and flag unresolved items, and reject contaminated quality-review suggestions across new and saved work.

**Architecture:** Keep the script detector in lib/thaiSpellcheck.ts as the shared seam. Add a pure review guard in qualityReview.ts, use it in client/API/editor, and reuse existing page retry, scanner and export report. No new dependency or schema migration.

**Tech Stack:** TypeScript, Next.js 16.3.6, Vitest, jsdom.

## Global Constraints

- Respect non-Thai targets and permitted Latin names/SFX, punctuation and symbols.
- Retain original text and layout; no destructive character stripping or silent suggestion acceptance.
- Retry at most once using the existing original-image retry; retain cleaner output and flag unresolved text.
- Do not call translation providers using real user work during verification.
- Read installed Next docs before route/client changes.

### Task 1: Shared Unicode detector

- [x] Add regression fixtures to tests/unit/thaiSpellcheck.test.ts; run RED.
- [x] Broaden countForeignScriptChars/describeForeignScripts; add isThaiTargetLanguage and foreign-character reporting without changing normalization.
- [x] Verify extended scripts and permitted Thai/Latin characters GREEN.

### Task 2: Quality-review guard

- [x] Add RED cases to tests/translation/qualityReview.test.ts and qualityReviewClient.test.ts for false approval, contaminated suggestion, missing source and network failure.
- [x] Add target-aware pure guard in lib/translation/qualityReview.ts; call from parseQualityReviews and reviewTranslatedBubbles with targetLang.
- [x] Apply the same guard to API review rows and strengthen target-specific prompt; verify non-Thai behavior.

### Task 3: Translation warning and saved editor

- [x] Add Hebrew retry and unresolved-result tests to tests/translation/useTranslation.scriptGuard.test.tsx, including saved scan and non-Thai scope.
- [x] Reuse broadened detector for existing retry; add final per-page warning to both rendering paths and editor guard for legacy suggestions without changing text.
- [x] Add editor regression to tests/cleaning/translationOverlay.test.ts and verify existing controls/history.

### Task 4: Verification and release

- [x] Run relevant files, TSC, lint and full regression suite; record actual failures and limits.
- [x] Use code-review against the fixed baseline and resolve findings.
- [x] Commit approved changes separately from unrelated existing files.
- [x] When current saved-work confirmation is available, build, sync and update owned runtime; verify served build ID and web/OCR health, including JS assets.
