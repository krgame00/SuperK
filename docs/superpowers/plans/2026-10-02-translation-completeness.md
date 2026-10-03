# Translation Completeness Implementation Plan

**Goal:** Retain legitimate repeated text, recover detected omissions, and warn before export.

**Architecture:** A pure geometry/coverage module serves both the translation hook and export review. The hook retries uncovered detected regions from Original and keeps partial successes. Export recomputes coverage from persisted cleaning and bubble data.

**Tech Stack:** TypeScript, React, Canvas, Vitest, Next.js 16.3.6.

## Constraints

- Preserve earlier uncommitted color/shadow work and unrelated working notes.
- No provider calls on the supplied explicit image for automated tests; use nonsexual synthetic fixtures.
- At most six targeted recovery requests per page, one attempt each. Protected areas remain excluded. Abort/safety/quota stop recovery.
- No commit/push or runtime restart without user request or timing approval.
- Coverage is limited to detected regions and is not semantic completeness proof.

## Tasks

- [x] Write failing tests in `tests/translation/completeness.test.ts` for geometry deduplication, coverage and bounded recovery; run with `node node_modules/vitest/vitest.mjs run tests/translation/completeness.test.ts` and confirm failures.
- [x] Add `lib/translation/completeness.ts`: `deduplicateTranslations(bubbles)`, `findMissingTranslationRegions(bubbles, scope)`, `recoverMissingTranslations(bubbles, scope, recover, signal)`. Use valid normalized boxes, nonempty text, protected exclusions and explicit manual deletions. Preserve existing entries and reject unrelated recovered entries.
- [x] Replace text-count deduplication in `hooks/useTranslation.ts`; crop uncovered regions from `recognitionUrl`, recover using the configured provider, map boxes to global coordinates, revalidate scope, and show unresolved counts for both translation paths.
- [x] Add hook integration tests and extend `tests/export/reviewGate.test.ts`. Use coverage in `lib/export/reviewGate.ts` and show missing counts in the existing export dialog in `src/app/page.tsx`; retain navigation and explicit confirmation.
- [x] Run translation/export suites, TypeScript and scoped lint. Request an independent focused review and fix important findings. Build production after approved service-update timing, then verify web build identity and OCR health.

Recovery interface: `recover: (box: number[]) => Promise<TranslatedBubble[]>` returns page-coordinate candidates. The orchestrator never replaces existing successful entries; it appends deduplicated candidates that cover the requested region and pass `withinTranslationScope`.

Verification: 365 tests passed across 49 translation/export/persistence test files; TypeScript passed; scoped ESLint zero errors and eight existing warnings. Independent review found partial-box coverage, Auto deletion restoration, and normalized provider error stopping; all received red regressions and fixes. Final independent focused run: 50 tests passed. Coverage requires at least 60% of the detected target area and rejects invalid or disproportionately large boxes; this remains a heuristic and can flag fragmented translations for manual review. Counters log detected/received/retained/recovered/missing counts without source text.

The historical source/PDF page 21 confirms missing text, but no live provider rerun on that page was performed. Old exported PDFs are not modified. The user approved a service update after confirming work was saved.

Deployment verified: production build `4y2IeW_Povl2niTj94yP_`, web HTTP 200 with matching served build identity, OCR health HTTP 200. Only the owned web process was stopped/restarted; new hidden web PID 43104. Branch `codex/translation-completeness`; no commit/push performed.

## Follow-up (2026-10-03): recovered candidates supersede partial renderings

User reported duplicated text inside single balloons after translation. Root cause: recovery appended the re-translated candidate while keeping the pre-existing partial/offset bubble that had failed to cover the target; `deduplicateTranslations` only merges identical text, so both rendered stacked. Fix: `recoverMissingTranslations` now drops existing non-manual, non-deleted bubbles whose valid box overlaps an admitted candidate by ≥50% of their area (candidate ratio guard ≤8×); manual ownership and tombstones are untouched. Tests: 3 added in `tests/translation/completeness.test.ts` (supersede, manual preserved, oversized box preserved); 415 tests across translation/export/persistence suites pass, tsc clean, scoped eslint clean.
