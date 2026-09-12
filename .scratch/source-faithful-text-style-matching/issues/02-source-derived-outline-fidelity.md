# 02: Source-Derived Outline Fidelity

**What to build:** Preserve source fill color, outline color, and outline thickness for text that genuinely has a stroke. The system must distinguish fill/core pixels, outline/stroke pixels, and anti-aliased transitions, then carry outline thickness as a scale-independent source-relative ratio so translated text keeps the same visual weight as it resizes.

**Blocked by:** 01: Plain Dialogue Source Fidelity.

**Status:** resolved

- [x] White text with a colored outline recovers and resolves the correct fill and outline colors without flattening to global black/white defaults.
- [x] Solid chromatic text with a genuine dark or light outline preserves the intended source colors.
- [x] Anti-aliased transition pixels do not replace the canonical recovered fill or outline color.
- [x] Source outline thickness is represented as an outline-to-glyph relative measurement rather than a fixed translated-font multiplier.
- [x] Resizing or changing translated font size scales the rendered outline proportionally to the source-derived ratio.
- [x] The overlay renderer uses the resolved source-derived thickness rather than the legacy fixed stroke-width formula for source-faithful profiles.
- [x] Regression coverage verifies observable style recovery and rendered stroke behavior rather than private clustering or distance-transform implementation details.

## Answer

Implemented source-derived outline fidelity. Style recovery now records explicit outline presence and a scale-independent outline-width ratio, monochrome/solid text no longer receives a synthetic stroke, and outlined text carries its source colors and relative thickness through resolution to Canvas rendering. Overlay tests verify that thicker source ratios produce proportionally thicker rendered strokes, while color-scenario tests verify real outline evidence and anti-alias-safe source colors.
