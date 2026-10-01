# Source Outline Evidence

## Goal and scope

Improve Auto outline recovery following the user's approval to start the recommended outline work. Keep original fill colors introduced in `bae5b19`. A source without a visible stroke should render without a fabricated stroke; a source with a visible stroke should retain its recovered stroke. Explicit readable styling can still add a contrast aid. Manual styles remain authoritative. Eyedropper controls and review navigation are separate work.

## Evidence and cause

The existing local real-source harness reproduces a false white outline for `p4-cyan-sfx`, a visually borderless cyan lettering crop. Both unmasked sampling and sampling with current detector support return an outline. All 12 selected crops return `hasOutline=true`; changing support alone does not resolve the issue.

`sampleTextColors.ts` explicitly synthesizes a contrasting outline when the chromatic branch detects no contour, marks plain black/white archetypes outlined, and always sets `hasOutline=true` in the generic branch. Existing universal-outline tests encode that prior policy. The renderer consumes these admitted profiles faithfully, so it reproduces the invented outline. Some pixel-count contour heuristics also lack a test that a candidate actually surrounds glyphs.

## Approaches

1. **Recommended: source evidence plus explicit readable fallback.** Remove synthetic strokes from recovered source profiles and validate contour location, contrast, and support before accepting a real outline. Keeps true outlines and addresses background contamination; requires tests across multiple source patterns.
2. **Remove only the universal fallback.** Smaller change, but unrelated dark/light artwork can still satisfy existing contour counts and produce false outlines.
3. **Disable all Auto outlines.** Avoids invented strokes but loses real white/dark/colored source contours; does not meet fidelity goal.

## Proposed behavior and architecture

- Extraction reports source outline presence and confidence. Counts alone cannot establish a contour: candidate colors must differ from fill, be locally supported around fill strokes, and pass existing background contamination gates. Antialiasing and a displaced shadow are not automatically an outline.
- Recovered profiles with no supported contour carry `hasOutline=false` and zero outline width/ratio. Unknown evidence must not be recorded as a confidently recovered white stroke.
- Preserve existing fill admission, gradient handling, and standard translated shadow. Do not introduce OpenCV/model dependencies or use expanded removal masks as authoritative glyph boundaries.
- Confirmed outlines preserve measured color and bounded thickness. White fill with a chromatic contour, chromatic fill with white/dark contour, and plain monochrome dialogue receive separate regression cases.
- Auto and source-faithful rendering follow recovered outline evidence. Explicit readable and rejected/uncertain fallback styles retain contrast assistance. Manual and disabled matching behavior remains.
- Existing Auto profiles need original-pixel reanalysis under the new extraction policy; update only outline evidence while preserving recovered fill and user-owned settings. Version the evidence and derived-render policy so saved images cannot retain obsolete fabricated strokes. Missing originals keep their available image and cannot claim successful reanalysis.
- Preview and export must use the same updated profile. The implementation plan must identify the existing sampling/restore path before choosing the migration hook, and prevent repeated analysis on each render.

## Acceptance and verification

Use deterministic labeled samples for no-outline cyan/red/orange/black/white, real white/dark/colored outlines, antialiasing, displaced shadows, unrelated nearby artwork, and insufficient evidence. First establish failing regressions against the current extractor. Preserve true contour cases when removing invented-outline expectations.

Rerun the 12 original-pixel crops and inspect a comparison showing source, extracted outline, and rendered output. Label borderless crops and outlined crops explicitly; ambiguous crops do not count as ground truth. Exact outline quality across all archive pages is outside this small corpus claim.

Check saved-page reanalysis, manual/readable preservation, missing-source fallback, cache invalidation and full/incremental save, plus preview/export parity. Run affected tests, TypeScript and lint, then independent review before deployment. No commit/push or service update until authorized for this work.

## Investigation ledger

- Real crop replay, current extractor: all 12 profiles outlined, including borderless `p4-cyan-sfx`.
- Same inputs with current detector support: still outlined; disproves mask omission as the sole cause.
- Assertion that `p4-cyan-sfx` has no source outline fails deterministically (`true` versus `false`).
- Source trace: synthetic-outline defaults originate in extraction and are retained by the admitted-source resolver. Old tests explicitly require universal outlines, confirming prior behavior rather than a deployment mismatch.

Design approved by the user on 2026-10-02. Implementation uses a pure contour check at source-profile finalization and outline-only saved-session migration. See the implementation plan for verification results.

The contour check uses bounded local evidence rather than promising pixel-perfect segmentation: fill seeds honor supplied glyph support, candidate planes cannot span three crop faces, rays allow at most two progressively blended antialias pixels, and visible contour bands must support at least three directions with 20% support. An outline merging into white background can be supported by its visible sides. These are conservative heuristics, not a full-book benchmark.
