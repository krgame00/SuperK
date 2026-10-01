# Source Outline Evidence Implementation Plan

> **For agentic workers:** Use subagent-driven-development with an independent migration worker and review at the final gate.

**Goal:** Recover actual source outlines without fabricating strokes in Auto.

**Architecture:** A pure pixel evidence module validates contour support on recovered profiles. A versioned migration refreshes only outline fields of old automatic profiles from originals before accepting cached renders.

**Tech Stack:** TypeScript, existing canvas sampling, IndexedDB, Vitest; no added dependencies.

## Constraints

Preserve recovered fills, gradients, manual/readable choices, standard shadow, and missing-source images. Keep removal masks out of source style analysis. No service restart or push until authorized.

## Task 1 — Source contour evidence

Files: `lib/colorMatching/sourceOutlineEvidence.ts`, `sampleTextColors.ts`, `types.ts`; tests `tests/colorMatching/sourceOutlineEvidence.test.ts`, existing extraction suites.

- [x] Write deterministic no-stroke and real-stroke pixel cases; assert `extractTextColors(sample).hasOutline === false` for plain fills and `true` for contrast rings. Run them and observe invented-outline failures.
- [x] Export `SOURCE_OUTLINE_VERSION = "source-outline-v1"` and `recoverSourceOutline(sample, fill, candidate): Pick<TextStyleProfile, "hasOutline" | "outlineWidth" | "outlineWidthRatio" | "outlineConfidence" | "sourceOutlineVersion">`.
- [x] Classify pixels close to fill/candidate, reject background-colored or broad connected candidate planes, and measure support in opposing directions around fill boundaries. Count only local contour pixels. Return zero widths without admitted contour support.
- [x] Apply the pure check at the recovered-profile finalization boundary, retaining existing fill/evidence/gradient outputs. Update only old universal-outline expectations, preserving explicit readable/fallback tests.
- [x] Run source outline and all color tests. Rerun labeled real crop replay; inspect false negatives for real white outlines and false positives for borderless cyan/red.

## Task 2 — Original-source migration

Files: `lib/colorMatching/outlineMigration.ts`, `hooks/useTranslation.ts`, `lib/projectStore.ts`; tests for migration, store and restore.

- [x] Add `sourceOutlineVersion?: string` to `TextStyleProfile` (Task 1 owner).
- [x] Add failing tests for legacy Auto profile refresh preserving fill/gradient, protected manual/readable profiles, current-version no-op, missing image, and persisted cache invalidation.
- [x] Implement `needsSourceOutlineRefresh(bubble)` and `refreshSourceOutline(bubble, sample)`; sample only original pixels, preserve fill and user settings, copy only recovered outline fields. Do not silently claim successful refresh for rejected/uncertain extraction.
- [x] During saved-session restore, refresh eligible pages before installing caches; mark successful changed pages dirty and remove obsolete derived renders. Preserve missing-original caches. Use versioned profiles to avoid repeated refresh.
- [x] Extend store render-policy invalidation to legacy outline profiles without resurrecting old images on full or incremental save. Keep metadata-only migration from overriding source or manual profiles.
- [x] Run migration/store/restore/autosave tests.

## Task 3 — Final verification

- [x] Run affected color/export/store/restore suites, `node node_modules/typescript/bin/tsc --noEmit`, targeted ESLint and `git diff --check`.
- [x] Request independent review of actual diff against approved spec; fix concrete findings and rerun affected gates.
- [x] Record real crop labels, evidence, limitations and deployment status in this plan. Ask for service update only after concrete verified work is ready.

Implementation approved by user on 2026-10-02; design file `docs/superpowers/specs/2026-10-02-source-outline-evidence-design.md`.

## Execution and evidence

Tasks 1 and 2 implemented. Task 3 regression/type/lint gates, final independent review, and user-authorized deployment are complete.

- Initial deterministic extraction tests: six failures for invented contours, four actual-contour cases passed. After contour finalization: ten passed.
- Independent probes reproduced three additional failures: artwork outside glyph support, a detached frame across a background gap, and a real narrow stroke clipped by one crop edge. Each became a failing regression and then passed after bounded fixes.
- Added a merged white/gray background pair: a real stroke was initially rejected while plain lettering passed. Local bounded contour exits preserve the visible real stroke without accepting an unbounded background plane.
- A pastel background on the fill-to-white blend line reproduced another false contour. Short (at most two pixels), progressively blended antialias transitions reject that gap while retaining real antialiased contours.
- Direct inspection corrected an earlier assumption about the real corpus: several p7 text crops do have white outlines. They are positive fidelity cases, not borderless ground truth. Real replay asserts white contours in p3 cyan/red/orange and p7 cyan/red over artwork, and no fabricated contour for p4 cyan SFX. All pass. Fill colors remain unchanged in all 12 sampled crops.
- Migration retains stored fills, gradients, manual/readable choices and failed-original caches. A recovered fill differing by RGB distance over 40 cannot certify outline refresh for the stored text. Successful refresh removes stale renders and cannot resurrect them through full/incremental saves; current version profiles skip repeat analysis.
- Final affected test run: 49 files, 370 tests passed. TypeScript passed. Targeted ESLint: zero errors, seven existing warnings. Diff whitespace check passed. No new dependencies or cloud calls.
- Local before/after style swatches: `.scratch/text-color-experiment/outline-comparison.png`. Inspected visually. Fixed stroke thickness is used for comparison; this is not a production canvas screenshot, exact stroke-width measurement, or all-33-page accuracy claim.

Independent final review: no remaining blockers; 70 focused tests and the real-source replay passed in the reviewer run. Source-outline profile versions also act as the derived-render migration key. The global source-fill policy remains stable so failed-original pages retain their available images until a successful outline refresh.

Deployment: user approved immediate update. Stopped only the verified owned web service, built production successfully, synced standalone assets and relaunched hidden Production VBS. Web and OCR both returned HTTP 200. Build ID: `gUwst0vMqdPm1dIFuRJk-`. Code remains on `codex/source-outline-evidence`, uncommitted; no push performed.
