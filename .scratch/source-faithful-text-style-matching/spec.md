# Source-Faithful Manga Text Style Matching Specification

**Triage:** `ready-for-agent`

## Problem Statement

Translated manga text currently does not reliably preserve the visual style of the source text. The system can identify a useful approximate fill and outline color, but several existing behaviors make translated text visibly different from the original even when the source style is simple and obvious.

The main user-visible failures are:

- Plain black dialogue on a white speech balloon can receive an artificial white outline even when the source text has no outline.
- High-confidence source colors can be changed by readability-oriented contrast correction, so the rendered result is safer to read but less faithful to the source.
- Outline thickness is derived from translated font size rather than measured from the source glyph structure.
- The current color-sampling path can treat a broad text-removal mask as though it were a glyph mask, allowing background artwork, skin, clothing, or bubble pixels to influence the sampled style.
- Nearby style fallback can inherit from the nearest text region even when the regions represent different visual roles, such as dialogue and decorative SFX.
- The style model does not explicitly represent important source properties such as “no outline,” outline-to-glyph thickness ratio, glow/shadow, gradient direction, style confidence band, or text style category.
- Manual styling is not modeled as a complete persistent override of every source-style property.

The result is that translated text can be technically readable yet look noticeably different from the original manga. The desired behavior is source-faithful rendering: preserve the original text appearance as closely as practical while still allowing safe fallback when the source style cannot be recovered with sufficient confidence.

## Solution

Introduce a source-faithful text style pipeline that treats the source manga image as the authoritative visual reference and carries a richer Source text style profile from sampling through resolution to rendering.

The system will:

1. Sample visual style from the original source image before cleaning or inpainting.
2. Treat Glyph mask and Text-removal mask as distinct concepts. Text-removal masks must never be used as authoritative glyph masks for style extraction.
3. Represent explicit outline presence, so text with no source outline is rendered without `strokeText` or an equivalent synthetic stroke.
4. Measure outline thickness relative to source glyph thickness instead of relying on a fixed font-size multiplier.
5. Preserve high-confidence source fill and outline colors without readability-driven contrast replacement.
6. Separate core fill, stroke/outline, and anti-aliased transition pixels so anti-aliasing does not contaminate the recovered source colors.
7. Recover gradient, glow, and shadow only when confidence is high enough to avoid inventing decorative effects.
8. Classify text into compatible style categories such as Dialogue, Narration/Caption, and SFX/Decorative, and restrict nearby fallback to compatible categories.
9. Use confidence bands: high-confidence styles are used directly, medium-confidence styles are re-analyzed, and low-confidence styles fall back safely.
10. Preserve complete manual overrides until the user explicitly returns that text region to Auto/Original style.
11. Never fail an otherwise successful page translation solely because style recovery failed; style uncertainty falls back to the global style and remains identifiable as fallback state.

## User Stories

1. As a manga translator, I want plain black dialogue to remain plain black when the source has no outline, so that the translated page does not look artificially bold or sticker-like.
2. As a manga translator, I want the system to preserve the source fill color when it is confidently detected, so that translated text visually belongs to the same artwork.
3. As a manga translator, I want the system to preserve the source outline color when it is confidently detected, so that decorative dialogue and SFX retain their intended appearance.
4. As a manga translator, I want the system to know when the source has no outline at all, so that it does not invent a white or black stroke for readability.
5. As a manga translator, I want outline thickness to follow the source lettering rather than a fixed translated-font formula, so that thin and heavy source strokes remain visually distinct.
6. As a manga translator, I want outline thickness to scale proportionally when the translated font size changes, so that the style remains consistent at different bubble sizes.
7. As a manga translator, I want style sampling to use the original source page rather than the cleaned page, so that the system measures the actual text that existed before inpainting.
8. As a manga translator, I want the Glyph mask to represent the visible text shapes rather than the broader Text-removal mask, so that artwork inside an OCR region does not pollute the detected text color.
9. As a manga translator, I want nearby character hair, skin, clothing, and panel artwork excluded from text-style sampling, so that those colors are not mistaken for lettering.
10. As a manga translator, I want anti-aliased edge pixels treated as transitions rather than primary text colors, so that the recovered fill and outline remain clean and intentional.
11. As a manga translator, I want high-confidence source colors to be preserved even when their contrast is lower than a readability heuristic prefers, so that fidelity wins when the evidence is strong.
12. As a manga translator, I want uncertain source styles to be analyzed again before falling back, so that the system makes one stronger attempt before giving up on source fidelity.
13. As a manga translator, I want low-confidence style recovery to fall back safely instead of guessing from noisy pixels, so that incorrect artwork colors are not rendered as text.
14. As a manga translator, I want style-recovery failure to leave translation functional, so that one uncertain color does not fail an entire page or batch.
15. As a manga translator, I want fallback-styled bubbles to remain identifiable as fallback, so that I can review and correct them later if needed.
16. As a manga translator, I want nearby style inheritance to stay within the same type of text, so that dialogue does not accidentally inherit the style of decorative SFX.
17. As a manga translator, I want Dialogue, Narration/Caption, and SFX/Decorative styles treated as distinct categories, so that local fallback respects the visual role of each text region.
18. As a manga translator, I want a high-confidence colored SFX style to remain colored after translation, so that expressive lettering is not flattened into generic black text.
19. As a manga translator, I want a high-confidence white-text-with-colored-outline style to preserve both layers, so that the translated result remains recognizable as the same effect.
20. As a manga translator, I want source glow or shadow reproduced only when the source evidence is strong, so that the system does not invent visual effects on ordinary dialogue.
21. As a manga translator, I want a clearly detected gradient to preserve its direction and dominant colors, so that decorative translated text remains close to the original design.
22. As a manga translator, I want uncertain multicolor text to fall back to a dominant source color rather than fabricate an unreliable gradient, so that uncertain styling remains stable.
23. As a manga translator, I want the renderer to let Canvas or the rendering engine generate new anti-aliasing for the translated glyphs, so that the system does not try to copy source pixels onto differently shaped Thai glyphs.
24. As a manga translator, I want manual text styling to override every automatically recovered style property, so that my corrections are never partially overwritten by automation.
25. As a manga translator, I want manual fill, outline presence, outline color, outline thickness, opacity, gradient, glow, and shadow choices to persist together, so that a manual correction behaves as one coherent style override.
26. As a manga translator, I want re-translation to preserve my manual style override, so that changing translated wording does not undo deliberate visual edits.
27. As a manga translator, I want Auto/Original style to be restored only when I explicitly request it, so that the system never silently takes control back from a manual override.
28. As a manga translator, I want source-style confidence to have clear behavior, so that I can trust that highly certain styles are preserved while uncertain ones are treated conservatively.
29. As a manga translator, I want high-confidence source style to be used directly at a confidence of at least 0.80, so that strong evidence is not weakened by fallback heuristics.
30. As a manga translator, I want medium-confidence style in the 0.60–0.79 range to trigger re-analysis before fallback, so that borderline regions receive additional scrutiny.
31. As a manga translator, I want style below 0.60 confidence to use a controlled fallback, so that the application avoids presenting weak guesses as faithful source recovery.
32. As a manga translator, I want normal monochrome dialogue to be handled by the same source-evidence rules as colored text, so that black and white are not special-cased into artificial outlines.
33. As a manga translator, I want source-faithful style behavior to work in both single-page and batch translation, so that visual quality does not depend on how translation was initiated.
34. As a manga translator, I want source-faithful style behavior to remain compatible with manual bubble editing and resizing, so that layout edits do not destroy the recovered visual style.
35. As a manga translator, I want exported images to use the same resolved style as the on-screen overlay, so that the downloaded page matches what I reviewed in the workspace.
36. As a maintainer, I want text-removal and glyph evidence to remain distinct domain concepts, so that future cleaning changes cannot accidentally change text-style sampling semantics.
37. As a maintainer, I want source fidelity and readability fallback to have explicit precedence rules, so that future refactors do not silently reintroduce automatic contrast correction for high-confidence styles.
38. As a maintainer, I want fallback inheritance to require compatible text style categories, so that proximity alone is never sufficient evidence for style sharing.
39. As a maintainer, I want source-style recovery and rendering to be testable through a small number of observable seams, so that the implementation can evolve without brittle tests of internal helper details.
40. As a maintainer, I want old or partially populated style profiles to degrade safely, so that saved projects created before this richer style model can still load and render.

## Implementation Decisions

- The authoritative visual input for automatic style recovery is the original source image before text removal or inpainting. The cleaned background is never the primary source for recovering the original lettering style.
- Glyph mask and Text-removal mask are separate contracts. A Text-removal mask may authorize cleaning pixels, but it must not be passed into style extraction as if it were precise glyph evidence.
- The Source text style profile will be expanded to represent at least fill color, explicit outline presence, outline color, outline-to-glyph thickness ratio, opacity, confidence values, source provenance, fallback state, and text style category.
- The style model may additionally carry high-confidence decorative effects such as gradient metadata, shadow, or glow. These effects must be optional and absent when evidence is insufficient.
- Outline absence is first-class state. A resolved style with no outline must cause the renderer to omit the outline/stroke operation rather than substituting a zero-confidence white or black outline.
- Outline thickness will be represented as a relative measurement against glyph thickness or an equivalent scale-independent source measure. The renderer converts that ratio to the translated font scale.
- Automatic high-confidence source styles take precedence over readability contrast correction. When source evidence is high-confidence, automatic resolution must not replace a low-contrast source outline merely to increase contrast.
- Readability-oriented global defaults remain valid fallback behavior for uncertain or unavailable source style, but they are not allowed to overwrite high-confidence source evidence.
- The sampling model separates source pixels into foreground text evidence, likely fill/core evidence, likely outline/stroke evidence, and anti-aliased transition evidence. Transition pixels influence confidence but are not treated as the canonical fill or outline color.
- Black/white dialogue is not handled by a hard-coded “always black with white outline” archetype. Monochrome text must go through the same outline-presence evidence rules as colored text.
- Gradient recovery is directional and only enabled when multiple source colors form sufficiently strong spatial evidence. Otherwise the profile records a dominant solid fill.
- Glow and shadow are only represented when their evidence is separable from normal anti-aliasing and neighboring artwork with high confidence.
- Per-character color mapping is not used. The translated script may contain a different number and shape of glyphs, so style is transferred at the region/style level rather than mapping source characters to translated characters.
- Style confidence uses three behavioral bands: high confidence at 0.80 or above, medium confidence from 0.60 through 0.79, and low confidence below 0.60.
- High-confidence profiles are eligible for direct source-faithful rendering.
- Medium-confidence profiles receive a bounded re-analysis/refinement pass before fallback. Re-analysis must remain local and deterministic and must not introduce a new cloud request.
- Low-confidence profiles use controlled fallback rather than weak source-color guessing.
- Nearby fallback is allowed only between compatible Text style categories. The initial canonical categories are Dialogue, Narration/Caption, and SFX/Decorative.
- Nearby fallback uses category compatibility as a prerequisite and spatial distance as a secondary selection criterion. Distance alone cannot justify inheritance.
- Manual style is a complete user-owned override. Automatic re-analysis, re-rendering, and re-translation must preserve it until the user explicitly requests a return to Auto/Original style.
- Style recovery is non-fatal to translation. If source style cannot be recovered, the translated text still renders with the global fallback style and retains fallback provenance for later review.
- Existing saved profiles that do not contain the new fields must remain loadable. Missing fields receive backward-compatible defaults rather than causing project-load failure.
- The same resolved Source text style profile must drive workspace rendering and export rendering so the exported asset matches the reviewed on-screen result.

## Testing Decisions

Tests will focus on externally observable behavior rather than private helper implementation. The implementation should preserve the smallest practical number of test seams and prefer existing test architecture.

### Seam 1 — Source Style Recovery

Provide a source image region, with precise glyph evidence when available, and observe the resulting Source text style profile.

Required behavior coverage includes:

- Plain black dialogue on a white speech balloon resolves to black fill with `hasOutline = false` rather than inventing a white outline.
- White text with a colored outline preserves the correct fill and outline colors.
- Solid chromatic text preserves the intended dominant fill.
- Adjacent artwork does not contaminate glyph color when glyph evidence is present.
- Broad background/text-removal evidence is never treated as authoritative glyph evidence.
- Anti-aliased transition pixels do not replace the recovered core fill or outline color.
- Outline thickness is represented as a scale-independent ratio.
- High-confidence gradient/glow/shadow evidence is retained, while ambiguous decorative evidence does not create an effect.
- Confidence output supports the agreed high/medium/low bands.

Prior art: existing color-matching scenario tests and synthetic pixel-region tests.

### Seam 2 — Style Resolution and Fallback Policy

Provide translated bubbles with Source text style profiles and global style defaults, and observe the resolved style and fallback behavior.

Required behavior coverage includes:

- High-confidence source fill and outline are preserved without readability contrast replacement.
- Explicit `hasOutline = false` remains no-outline after resolution.
- Medium-confidence profile behavior follows the bounded re-analysis policy before fallback.
- Low-confidence style resolves to the global fallback instead of a weak guess.
- Nearby fallback inherits only from a compatible Text style category.
- Dialogue cannot inherit from SFX/Decorative merely because it is closer.
- Manual override takes precedence over all auto/fallback style decisions.
- Existing legacy profiles without new fields resolve safely.

Prior art: existing automatic style-resolution and nearby-style-fallback tests.

### Seam 3 — Rendered Overlay Behavior

Provide bubbles and resolved profiles to the translation overlay and observe Canvas/render/export behavior.

Required behavior coverage includes:

- No-outline profiles do not execute a stroke operation.
- Outlined profiles use source-derived relative thickness at the translated font size.
- Fill and outline rendered colors match the resolved style.
- Supported gradient/glow/shadow effects are rendered only when present in the profile.
- Manual styles remain unchanged after a re-render.
- A fallback style still renders successfully and never causes translation failure.
- Exported rendering follows the same style semantics as the interactive workspace overlay.

Prior art: existing translation-overlay behavior tests and export/render tests.

## Out of Scope

- Pixel-for-pixel copying of the source glyph raster onto translated text.
- Mapping source colors character-by-character to Thai or other translated glyphs.
- Reproducing the exact source font family when the font itself is unavailable or unidentified.
- Using an additional cloud/AI request solely to classify text style or recover text color.
- Allowing style recovery failure to block or fail page translation.
- Treating the broad Text-removal mask as a substitute for Glyph mask accuracy.
- Automatically modifying high-confidence source colors to satisfy contrast/readability heuristics.
- Exposing low-level confidence thresholds or sampling internals as normal user-facing tuning controls in the first release.
- Guaranteeing perfect recovery of complex hand-painted lettering, texture fills, perspective-warped text, or effects that cannot be represented by the current Canvas rendering model.

## Further Notes

The governing principle is **source fidelity first when the source evidence is strong; safe fallback when it is not**.

The canonical domain terms are Source text style profile, Glyph mask, Text-removal mask, Style confidence band, Text style category, Nearby color profile, and Source-faithful text rendering. The architectural rationale is recorded in ADR 0006.

The confirmed test strategy intentionally uses three seams only: source style recovery, style resolution/fallback policy, and rendered overlay behavior. This keeps tests focused on user-observable outcomes and avoids coupling the specification to one particular clustering, distance-transform, or Canvas implementation.
