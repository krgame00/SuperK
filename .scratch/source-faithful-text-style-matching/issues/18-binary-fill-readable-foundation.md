# 18: Binary Fill Readable Foundation

**What to build:** Replace free-form Readable fill selection with the Binary Fill + Source Outline policy end to end. Validated source-faithful styles remain source-faithful, while Auto → Readable fallback and explicit Readable mode may render only white or black glyph fill and must always include an outline.

**Blocked by:** None (can start immediately; the prior Adaptive Readable wave 13–17 is already closed).

**Status:** closed

- [x] A region admitted as a validated Source text style profile keeps its authored fill instead of being converted to white/black merely because Binary Fill exists.
- [x] A validated source-faithful profile preserves authored outline presence or absence, including legitimate no-outline source text.
- [x] Auto follows the existing source/re-analysis/validated-nearby chain before entering Binary Fill Readable fallback.
- [x] Auto → Readable fallback emits only pure white or pure black glyph fill.
- [x] Explicit Readable mode emits only pure white or pure black glyph fill.
- [x] Every Binary Fill Readable result has an explicit outline.
- [x] Chromatic fill is not emitted by Readable fallback even when the detected source color is chromatic.
- [x] Existing Auto ownership remains Auto when fallback occurs and still exposes Readable fallback provenance/reason.
- [x] Manual ownership is not converted to Binary Fill and is never automatically outlined/recolored by this policy.
- [x] Validated decorative Source text style profiles remain source-faithful; Binary Fill simplification applies only after a region enters Readable behavior.
- [x] Legacy/partial profiles resolve safely without turning an existing Manual profile into Auto/Readable ownership.
- [x] Tests cover the externally observable Style Resolution + Readability/Fallback Policy and Overlay/UI/Export Behavior seams, including revision of older universal-outline/thematic-remapping expectations that conflict with the new ownership contract.
