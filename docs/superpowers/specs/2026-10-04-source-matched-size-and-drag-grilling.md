# Source-matched text size and dense-page interaction — interview

## Task boundaries

The user separately requests automatic source-matched text sizing and smoother move/scale interactions on pages containing many text points. The preceding multilingual-guard interview remains recorded separately; this new request does not approve its implementation or alter its decisions.

## Confirmed round 1

- Q1: Match the visible letter height at the same page scale, not the entire text block or a nominal font px value. Line count and layout frame may differ from the source.
- Q2: Default new translations to source-matched sizing. Older work requires an explicit sizing command. Preserve user-adjusted sizes until explicitly returned to automatic sizing.
- Q3: Both movement and scaling stutter on pages with many text points; both are required performance verification cases.

## Confirmed round 2

- Q4: Longer translations retain source size, wrap and increase height within available space; unresolved overflow is reported, not silently shrunk or expanded over other content.
- Q5: Reliable small source glyphs retain source size with a readability warning; the user may enlarge them manually.
- Q6: Uncertain measurements use the current sizing strategy as a labeled temporary fallback, not claimed source-matched size.

## Code facts

- The existing renderer chooses font size from available frame dimensions and translated text fit; it does not recover source glyph size.
- Source style and OCR evidence structures do not currently provide a trusted original font/glyph size.
- A prior drag fix already coalesces movement/corner events per animation frame and reuses the movement/rotation bitmap. New profiling must reproduce the reported dense-page failure rather than assume the old issue remains unfixed.
- Existing side handles preserve font size and reflow; corner handles scale proportionally. Source-matched sizing must preserve those explicit interaction contracts and Undo/Redo.

## Resolved design branches

- Original glyph evidence, actual-font metrics and source/region provenance; attempt rotation/vertical/SFX with explicit uncertain fallback.
- Overflow constrained by reliable source text-space boundaries or existing layout space; preserve explicit manual geometry.
- Dense-page bitmap preview with exact settled gesture state; profiling establishes the actual performance cause before implementation.
- Preserve workspace/export/extension size parity and bounded caches; source changes invalidate measurement provenance, manual sizing remains user-owned.
- Proposed measurable acceptance is in the two design files; user confirmation of shared understanding remains required before planning/implementation.

## Confirmed round 3

- Q7: bitmap scaling during corner gestures with crisp settled rendering. Slight temporary softness is acceptable; no release jump or changed line structure. Width dragging still needs live reflow.
- Q8: automatic height accommodation is limited by reliable balloon/text boundaries, falling back to existing layout space; manually configured layout space remains authoritative.

## Investigation references

- `lib/translationOverlay.ts`: initial source-independent fitting, targetFontSize locking, frame scheduling, chrome position reads, per-point canvas/chrome allocation and release-time persistence.
- `lib/colorMatching/types.ts` and `ocr-service/app/schemas.py`: source style and region evidence do not yet include trusted glyph-size measurements.
- `tests/cleaning/translationOverlay.test.ts`: existing single-point coalescing/cancellation regressions; `scripts/verify-tight-selection.mjs` and `tests/browser/tight-selection.ts`: browser harness reusable for dense-page measurement.
- Suspected remaining costs (not proven): per-point DOM/canvas count, geometry read/write ordering, duplicate width layout/segmentation work, selected-point chrome positioning and release-time style/storage work. Browser traces are required before choosing the minimal performance changes.

## Completion

All eight interview questions have answers. Product decisions are captured in separate source-size and interaction designs and ADR 0020. The proposed validation compares reliable visible-height fixtures within 10% (allowing pixel rounding) and measures 10/50/100-point browser scenes at 44%/100% zoom. This does not claim perfect source measurement or 60 FPS on all hardware. Final shared-understanding confirmation is pending; no production implementation has started.
