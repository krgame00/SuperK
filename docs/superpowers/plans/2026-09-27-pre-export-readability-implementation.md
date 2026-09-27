# Pre-export typesetting readability implementation — 2026-09-27

Status: **VERIFIED WORKING (automated tests)**. Source: [approved design](../specs/2026-09-27-pre-export-typesetting-readability-design.md) and five local tickets in `.scratch/pre-export-typesetting-readability/issues/`.

## Implemented

1. Shared renderer measurement now reports overflow and font size below 75% of the existing readable minimum. The report retains translation, script, box, and cleaning fields and navigates to a named text item.
2. Local contrast assessment samples the clean background at the translated glyph footprint, including rotated items. Missing image, font, background, or pixels remain unavailable rather than passing.
3. Single-image, ZIP, CBZ, PDF, and strip export routes run the readability scan. Book exports show page progress and allow early continuation; the existing uncertain-page review gate still runs afterward.
4. A completed warning set acknowledged by explicit continuation is remembered for this workspace session and page revision. Unknown and unfinished scans are never acknowledged.

## Verification evidence

- Initial full Vitest run after export-flow implementation: **154 files passed, 993 tests passed, 1 skipped**. Four existing ESLint warnings and no errors on touched files.
- Focused review-fix run: geometry, glyph sampling, color, and workspace workflow: **4 files passed, 33 tests passed**.
- Final full Vitest run after review fixes and export-format/unknown-result tests, with four workers: **155 files passed, 1003 tests passed, 1 skipped**. A timing-sensitive pre-existing Space shortcut test was changed to wait for session restore before asserting. An unrelated toolbar test hit its 5-second timeout under the default worker load; it passed 2/2 in isolation and the full four-worker run passed.
- TypeScript baseline: `tests/chrome-extension/bidirectionalPublishing.test.ts:68` reports TS2306 because `chrome-extension/background.js` is not a module. The same error existed before this feature branch.

## Review and follow-up

- Two-axis review found renderer fallback/legacy adjustment, missing-font, incomplete-pixel, and glyph-footprint gaps. These were corrected with focused tests.
- A documented working-notes requirement and repeated page-scan setup were also corrected.
- Independent end-to-end review found that export-only offscreen rendering incremented the page edit revision, which would invalidate an acknowledged warning without a user edit. Removed that render-only revision bump.
- Integration with `main` (2026-09-27): merged `origin/main` at `6723ef1`. Resolved the text-renderer conflict by sharing the new frame-growth rule with the readability scanner, preserving the main branch's automatic frame growth. The merged result passed **155 Vitest files / 1009 tests, 1 skipped** with four workers; touched-file ESLint had **0 errors / 4 existing warnings**. TypeScript retained only the existing TS2306 Chrome extension test error.
