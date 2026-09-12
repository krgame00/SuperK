# 13: Adaptive Readable on Bright & White Backgrounds

**What to build:** Replace the fixed light/white Readable fallback with an Adaptive Readable path that evaluates the actual Inpainted clean background beneath the Translated glyph footprint and chooses a conservative Fill + Outline pair that remains legible. This slice must solve the reported white-on-white failure end to end without regressing validated source-faithful no-outline text.

**Blocked by:** None (can start immediately; tickets 08–12 are already closed).

**Status:** closed

- [x] Auto → Readable fallback and explicit Readable mode evaluate the Inpainted clean background beneath the Translated glyph footprint rather than assuming a fixed white preset.
- [x] Adaptive Readable evaluates multiple conservative Fill + Outline candidate pairs, including both light-fill/dark-outline and dark-fill/light-outline options.
- [x] Adaptive Readable output always has an outline, while a validated source-faithful no-outline profile remains no-outline.
- [x] White or near-white speech balloons prefer a dark-fill readable candidate instead of rendering white-on-white text.
- [x] Dark backgrounds can still select a light-fill readable candidate when it provides stronger separation.
- [x] The background sampling surface follows the translated layout footprint plus a small readability margin rather than the entire OCR box.
- [x] Explicit Readable mode uses the same adaptive candidate-selection semantics without pretending the result is recovered source style.
- [x] Auto retains Auto ownership when fallback occurs and exposes `Auto → Readable fallback` plus a reason.
- [x] Manual style remains fully user-owned and is not recolored or outlined by Adaptive Readable logic.
- [x] Legacy/partial style profiles continue to resolve safely with backward-compatible defaults.
- [x] Regression coverage includes the reported bright/white-background failure and proves that the visible fallback text no longer disappears against the background.
- [x] Tests cover the Style Resolution + Readability/Fallback Policy and Overlay/UI/Export Behavior seams without locking private candidate-scoring helpers.
