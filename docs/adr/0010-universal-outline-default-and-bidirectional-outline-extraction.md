# 0010. Universal Outline Default and Bidirectional Outline Extraction

Date: 2026-09-13

## Status

Accepted — outline-extraction decision remains; universal-outline default narrowed by ADR 0012 for validated source-faithful no-outline text

## Context

ADR 0006 established source-faithful rendering to avoid imposing artificial outlines when source manga text lacked one. ADR 0007 and ADR 0008 introduced evidence gating and adaptive outlines for readable fallbacks, but preserved the rule that high-confidence source styles without detected outlines should be rendered borderless.

Real-world usage exposed two compounding flaws:
1. **Missed Light Outlines (Sampling Defect):** `sampleTextColors.ts` only evaluated dark contour pixels (`hasDarkOutline`) when analyzing chromatic lettering. In actual manga art, colored dialogue and sound effects frequently use bright white or light-tinted outlines (e.g., cyan text with white stroke, orange text with white stroke). Because light contours were not tested, these texts were erroneously classified as `hasOutline: false`.
2. **Invisible Borderless Text (Contrast Failure):** When text was classified as borderless, it rendered with zero stroke width (`ctx.lineWidth = 0`). Placed over similarly colored manga panel artwork (e.g., cyan text on night sky/dark blue background, or orange text on skin/warm tones), the translated text completely blended into the background and became illegible.

Typesetters in professional scanlation always enforce a contrasting stroke on dialogue and sound effects placed over artwork to guarantee legibility across dynamic illustrations.

## Decision

1. **Universal Outline Default:**
   All translated text in SuperK renders with a contrasting stroke/outline by default. The default stroke width ratio is established at ~0.12–0.14 of font size (approximately 2–3px), ensuring optimal readability without clogging Thai glyph loops and tone marks (e.g., สระอิ, ไม้โท, ฎ, ฏ).
   - If the source manga contains a validated outline (recovered faithfully), that outline color and width are preserved.
   - If the source text has no outline (or outline detection is inconclusive), the system provides an automatic contrasting outline based on high-contrast luminance (e.g., white outline for dark/vivid fills or dark backgrounds, black outline for light fills on bright backgrounds).
   - Users retain the ability to set `strokeWidth: 0` or customize outline colors manually via the Text Properties Panel (`Manual style override`).

2. **Bidirectional Outline Extraction:**
   The text color extractor in `sampleTextColors.ts` is upgraded to sample both white/light contours and dark contours around chromatic glyph cores. When a chromatic text cluster is surrounded by white or bright contour pixels, it is faithfully admitted with `hasOutline: true`, matching the source artwork.

3. **High-Contrast Luminance Fallback:**
   When an outline must be inferred or when contrast against the local background is insufficient, the outline color is determined dynamically by maximizing luminance distance against both the glyph fill and the local clean background.

## Consequences

- Resolves illegible text blending into background art without requiring manual styling per bubble.
- Source-faithful fidelity is enhanced: colored text with white borders is now correctly recognized rather than degraded to borderless text.
- Standard dialogue and floating text gain reliable contrast against arbitrary manga backgrounds.
- Manual style overrides remain respected: users can still choose a borderless look explicitly if desired.
- Existing unit tests for source fidelity and fallback chains will be updated to reflect the Universal Outline Default policy.
