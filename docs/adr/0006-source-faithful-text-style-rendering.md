# 0006. Source-Faithful Text Style Rendering

Date: 2026-09-12

## Status

Accepted; the high-confidence fidelity-precedence rule is narrowed by ADR 0007, which requires source-evidence and readability validation before automatic source-faithful rendering.

## Context

Translated manga text currently favors readability safeguards: black/white archetypes may be normalized, outlines may be introduced or contrast-corrected automatically, and stroke width is derived mainly from translated font size. This makes ordinary dialogue readable but can visibly diverge from the source artwork, especially when the source has no outline, colored lettering, decorative SFX, glow, or unusual stroke proportions.

## Decision

When source glyph evidence is reliable, SuperK will preserve the recovered Source text style profile rather than normalize it for readability. Style recovery is based on the original pre-clean image and glyph-specific evidence, not the inpainted background or the broader text-removal mask. High-confidence profiles render faithfully, including absence of outline; medium-confidence profiles are re-analyzed before fallback; low-confidence profiles fall back without failing translation. Nearby inheritance is allowed only within the same Text style category, and manual user overrides remain authoritative until explicitly returned to Auto/Original style.

## Consequences

- Source fidelity takes precedence over automatic contrast correction for high-confidence styles.
- Glyph-mask quality becomes part of style-recovery quality; text-removal masks are not treated as glyph masks.
- Outline presence and relative thickness must be measured from source glyph evidence rather than inferred solely from translated font size.
- Decorative effects such as gradients, shadows, and glow are reproduced only when confidently detected; otherwise the renderer degrades to a simpler dominant style.
- Style-detection failure must not fail page translation; affected text renders with a marked fallback style instead.
