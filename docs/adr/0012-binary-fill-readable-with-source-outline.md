# 0012. Binary Fill Readable with Source Outline

Date: 2026-09-15

## Status

Accepted — supersedes Readable fill-selection details in ADR 0008, narrows ADR 0010, and supersedes ADR 0011's automatic chromatic-artwork remapping

## Context

The source-style pipeline has progressively separated trustworthy source fidelity from safety fallback. ADR 0007 added evidence-gated source admission. ADR 0008 made Readable fallback background-aware and outlined. ADR 0010 then applied a universal outline default, and ADR 0011 introduced a white-fill/chromatic-outline treatment for chromatic artwork text.

Real usage still shows that allowing many chromatic fallback fills and applying outline policy broadly can make behavior harder to predict. The user wants a simpler rule for safety output: when the system is no longer rendering a validated Source text style profile, the translated glyph body should be either white or black, while the outline carries source color identity where that remains readable.

This deliberately trades some fallback color fidelity for repeatable readability and clearer ownership semantics.

## Decision

1. **Source-faithful path remains source-faithful.**
   A Source text style profile that passes the Source style evidence gate and automatic Readability gate keeps its admitted source fill, outline presence or absence, relative outline width, opacity, and supported source effects. A validated no-outline source profile may render no-outline.

2. **Readable fill becomes binary.**
   Auto → Readable fallback and explicit Readable mode may use only pure white (`#FFFFFF`) or pure black (`#000000`) as glyph fill. Chromatic fallback fill is not allowed.

3. **Readable output always has an outline.**
   The outline is the primary place to retain safe source color identity in fallback output.

4. **Source accent drives the preferred fallback pair.**
   When trustworthy source color evidence is available, a Source accent color is derived from the admitted/recovered source profile or safe source-color evidence. Luminance/brightness is the primary classifier:
   - light/bright accent → prefer white fill + Source-accent outline;
   - dark/near-black accent → prefer black fill + white/light high-contrast outline;
   - ambiguous mid-tone accent → evaluate both binary fill directions through the Readability gate.

5. **The mapping is a preference, not final admission.**
   The preferred pair must still pass background-aware readability against the Inpainted clean background beneath the Translated glyph footprint. If it fails, the alternate binary fill direction and safe outline variants are evaluated. Fill remains white or black throughout.

6. **Source-accent outlines may be strengthened.**
   A pastel or weak Source accent outline may be darkened/strengthened while preserving hue where practical. Exact source RGB is not required in Readable behavior when it would reduce legibility. A safe neutral outline may be used if the Source accent cannot provide sufficient separation.

7. **Decorative fallback is simplified.**
   Validated source gradient/glow/shadow remains source-faithful. Once a region enters Readable behavior, uncertain source decorative effects are not reproduced; the fallback is reduced to binary fill, readable outline, and only the later safety escalation required for legibility.

8. **Existing background-aware safety remains.**
   Multiple footprint samples, broad plus weak-region readability checks, proportional outline escalation, controlled readability halo/shadow, Overlay Subtitle-only plate escalation, review-required state, and layout-commit recomputation remain in force.

9. **Ownership remains explicit.**
   Auto stays Auto when it falls back and exposes `Auto → Readable fallback`. Explicit Readable intentionally uses Binary Fill + Source Outline. Manual remains fully user-owned and may be warned about but is never rewritten automatically.

## Consequences

- Readable fallback becomes more deterministic: the glyph body is always black or white.
- Source identity is retained mainly through the fallback outline rather than through uncertain chromatic fill.
- Bright/white backgrounds and dark backgrounds can reject the preferred source-luminance mapping when local readability requires the opposite binary fill.
- ADR 0010's universal-outline rule is narrowed: mandatory automatic outline applies to Readable output, while validated source-faithful no-outline profiles may remain borderless.
- ADR 0011's automatic conversion of chromatic artwork text to white fill is superseded as a general source-style rule. White fill + chromatic outline remains a valid Readable candidate when the Source accent and local background support it.
- Tests that encode universal outline or thematic remapping as unconditional behavior must be revised to assert the new source-vs-Readable ownership contract.
- No additional cloud or AI request is introduced.
