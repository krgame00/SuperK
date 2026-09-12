# 06: High-Confidence Decorative Effects

**What to build:** Preserve decorative source effects only when the evidence is strong enough to be trustworthy. SFX/Decorative text may carry directional gradients, glow, or shadow when confidently detected; ambiguous multicolor or effect evidence must degrade to a simpler dominant solid style rather than inventing decoration.

**Blocked by:** 02: Source-Derived Outline Fidelity; 03: Confidence Bands & Non-Fatal Style Recovery.

**Status:** ready-for-agent

- [x] A clearly detected source gradient can preserve its dominant colors and direction at the region/style level.
- [x] Ambiguous multicolor evidence falls back to a dominant solid source color rather than fabricating a gradient.
- [x] Glow or shadow metadata is produced only when it can be distinguished from ordinary anti-aliasing and nearby artwork with sufficiently high confidence.
- [x] Ordinary dialogue does not receive decorative effects merely because noisy neighboring pixels exist.
- [x] Decorative effects do not use per-character source-to-translation color mapping.
- [x] Rendered gradients, glow, and shadow are driven by the resolved Source text style profile and remain compatible with translated glyph shapes.
- [x] Style uncertainty in decorative effects remains non-fatal and can degrade to the simpler resolved style.
- [x] Regression coverage verifies both high-confidence effect preservation and ambiguous-effect suppression.
