# Source-Faithful Text Style Matching — Map

## Notes

- Shared Understanding was confirmed after Q1-Q16 of the grill-with-docs design interview.
- The feature specification is published at `spec.md` with triage `ready-for-agent`.
- Three confirmed test seams govern implementation: source style recovery, style resolution/fallback policy, and rendered overlay behavior.
- A small amount of implementation/test work began before the user requested `to-spec`; it remains in the working tree and must be reconciled against the published specification rather than silently discarded.

## Decisions-so-far

- Source fidelity takes precedence over readability correction when source evidence is high-confidence.
- Source text style is sampled from the original page before cleaning/inpainting.
- Glyph mask and Text-removal mask are distinct contracts; the latter is not authoritative glyph evidence.
- Explicit no-outline state is first-class and must result in no stroke rendering.
- Outline thickness is transferred as a source-relative ratio, not a fixed font-size formula.
- Confidence bands: high `>= 0.80`, medium `0.60–0.79` with bounded local re-analysis, low `< 0.60` with safe fallback.
- Nearby fallback is category-compatible only: Dialogue, Narration/Caption, and SFX/Decorative.
- Manual override owns all style properties until the user explicitly returns to Auto/Original.
- Style recovery failure is non-fatal to translation.
- Gradient/glow/shadow are reproduced only with sufficiently strong source evidence.

## Ticket Frontier
 
- `01` Plain Dialogue Source Fidelity — [DONE]
- `02` Source-Derived Outline Fidelity — [DONE]
- `03` Confidence Bands & Non-Fatal Style Recovery — [DONE]
- `04` Category-Safe Nearby Style Fallback — [DONE]
- `05` Persistent Manual Style Ownership — [DONE]
- `06` High-Confidence Decorative Effects — [DONE]
- `07` End-to-End Style Parity & Release Regression — [DONE]

Current frontier: All tickets 01–07 completed and verified across all 3 confirmed behavior seams. All 520 tests passing.

## Fog

- The exact internal glyph-mask derivation/refinement algorithm remains an implementation choice as long as it satisfies the source-style-recovery seam and never substitutes the Text-removal mask as authoritative glyph evidence.
- The exact representation of gradient/glow/shadow metadata remains an implementation choice as long as backward compatibility and observable rendering behavior are preserved.
