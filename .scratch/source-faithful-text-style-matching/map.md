# Source-Faithful Text Style Matching — Map

## Notes

- Q1–Q16 established source-faithful rendering and the three original behavior seams.
- Q17–Q30 revised automatic source admission after background/artwork contamination produced unreadable sampled colors.
- Q31–Q48 revised Readable behavior after a fixed white fallback became unreadable on white/bright backgrounds.
- The current specification is `spec.md`, triaged `ready-for-agent`, and now defines Adaptive Readable + mandatory outline for the Readable path.
- The confirmed test strategy remains exactly three seams: Source Style Recovery + Evidence Admission; Style Resolution + Readability/Fallback Policy; Overlay/UI/Export Behavior.
- ADR 0006 governs source-faithful rendering, ADR 0007 governs gated source admission and fallback ordering, and ADR 0008 governs Adaptive Readable fallback.
- Existing implementation/test changes in the working tree must be reconciled against the current spec; do not silently discard prior work.

## Decisions-so-far

- Source style recovery uses the original pre-clean image; readability fallback evaluates the Inpainted clean background actually shown behind translated text.
- Glyph mask and Text-removal mask remain distinct contracts.
- Automatic source style must pass Source style evidence and Readability gates; confidence alone never admits source style.
- Validated source no-outline remains no-outline. Mandatory outline applies only to Readable and Auto → Readable fallback.
- Adaptive Readable samples the background under the Translated glyph footprint rather than the entire OCR box.
- Adaptive Readable evaluates multiple conservative Fill + Outline candidate pairs instead of defaulting to white fill.
- White or near-white balloons bias toward dark fill.
- Readability considers both broad/overall separation and weak local regions; behavioral targets are roughly 4.5:1 across most sampled areas and avoiding materially weak regions around 3:1 when a stronger candidate is available.
- Readable outline scales with glyph size, normally around 0.10–0.14 and escalating roughly to 0.16–0.20 when necessary without clogging Thai glyph shapes.
- Escalation order is normal Fill + Outline → thicker Outline → controlled Shadow/Halo → Background Plate where allowed.
- Automatic Background Plate is restricted to Overlay Subtitle as a last resort. Dialogue and Narration / Panel Caption use the strongest non-plate candidate and review-required state if still insufficient.
- Canonical Text style categories remain Dialogue, Narration / Panel Caption, SFX / Decorative, and Overlay Subtitle.
- Automatic fallback order remains own validated source → bounded re-analysis → validated same-category Nearby color profile → Adaptive Readable fallback.
- Auto remains Auto when fallback occurs and exposes `Auto → Readable fallback` plus a reason. Readable intentionally uses Adaptive Readable. Manual remains fully user-owned.
- Auto/Readable recompute after committed layout changes that alter the translated glyph footprint; they do not recompute every pointer frame. Manual is never adaptively rewritten.
- Style/readability failure remains non-fatal to single-page and batch translation.
- Workspace and export consume the same final resolved style, escalation state, and fallback provenance.

## Ticket History

First source-fidelity wave:
- `01` Plain Dialogue Source Fidelity
- `02` Source-Derived Outline Fidelity
- `03` Confidence Bands & Non-Fatal Style Recovery
- `04` Category-Safe Nearby Style Fallback
- `05` Persistent Manual Style Ownership
- `06` High-Confidence Decorative Effects
- `07` End-to-End Style Parity & Release Regression

Evidence-gating regression wave:
- `08` Evidence-Gated Source Style on Complex Backgrounds
- `09` Overlay Subtitle Classification & Readable Safety Path
- `10` Validated Fallback Chain & Nearby Admission
- `11` Auto / Readable / Manual Style Ownership UX
- `12` Reported-Regression E2E & Export Parity

Adaptive Readable + Outline wave:
- `13` Adaptive Readable on Bright & White Backgrounds — [READY / current frontier]
- `14` Mixed-Background Readability Scoring & Outline Escalation — blocked by `13`
- `15` Readability Halo, Overlay Plate & Review Escalation — blocked by `14`
- `16` Layout-Commit Adaptive Recalculation & Ownership Persistence — blocked by `13` and `14`
- `17` Adaptive Readable Regression & Export Parity — blocked by `13`, `14`, `15`, and `16`

Current frontier: `13` can start immediately. After `14` resolves, tickets `15` and `16` can proceed independently, and `17` is the final integration/regression gate once both are complete.

## Fog

- The exact internal contrast formula, percentile calculation, sampling density, and safe-candidate scoring remain implementation choices as long as the confirmed behavior thresholds and seams are satisfied.
- The exact visual cap for outline thickness may depend on font/glyph metrics; it must preserve Thai glyph counters and remain within the confirmed proportional ranges when practical.
- The exact shape/opacity of the final Overlay Subtitle background plate remains an implementation choice as long as it is only reached after earlier readable escalation fails and workspace/export parity is preserved.
