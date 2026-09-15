# Source-Faithful Text Style Matching — Map

## Notes

- Q1–Q16 established source-faithful rendering and the three original behavior seams.
- Q17–Q30 revised automatic source admission after background/artwork contamination produced unreadable sampled colors.
- Q31–Q48 revised Readable behavior after fixed white fallback became unreadable on white/bright backgrounds.
- Q49–Q56 are the latest confirmed revision: Readable behavior now uses **Binary Fill + Source Outline**.
- The current specification is `spec.md`, triaged `ready-for-agent`, and supersedes free-form Adaptive Readable fill selection with binary white/black fallback fill.
- The confirmed test strategy remains exactly three seams: Source Style Recovery + Evidence Admission; Style Resolution + Readability/Fallback Policy; Overlay/UI/Export Behavior.
- ADR 0006 governs source-faithful rendering, ADR 0007 governs gated source admission/fallback ordering, ADR 0008 retains background-aware readability/escalation constraints, ADR 0010 retains bidirectional outline extraction but has its universal-outline rule narrowed, ADR 0011 is superseded for automatic remapping, and ADR 0012 governs the current Binary Fill Readable policy.
- Existing implementation/test changes in the working tree must be reconciled against the latest spec; do not silently discard prior work.

## Decisions-so-far

- Source style recovery uses the original pre-clean image; Readable safety evaluates the Inpainted clean background actually shown behind translated text.
- Glyph mask and Text-removal mask remain distinct contracts.
- Automatic source style must pass Source style evidence and Readability gates; confidence alone never admits source style.
- Validated source styling remains source-faithful, including authored source fill, effects, and outline presence/absence. A validated no-outline source may remain no-outline.
- Automatic fallback order remains own validated source → bounded re-analysis → validated same-category Nearby color profile → Readable fallback.
- Readable fallback is now **Binary Fill + Source Outline**: glyph fill is restricted to pure white or pure black and every Readable result has an outline.
- A trustworthy **Source accent color** may tint the Readable outline; it is not used as chromatic fallback fill.
- Source accent classification is luminance-led, not hue-name-led.
- Light/bright Source accents prefer white fill + Source-accent outline; dark/near-black accents prefer black fill + white/light outline; ambiguous mid-tones evaluate both binary directions.
- Preferred mapping is not final admission. Background-aware Readability can reject it and choose the alternate white/black direction or safer outline.
- Weak/pastel Source-accent outlines may be strengthened/darkened while preserving hue where practical; a neutral high-contrast outline is allowed when the accent cannot separate sufficiently.
- Binary Readable samples the background under the Translated glyph footprint rather than the entire OCR box.
- Readability considers broad/overall separation and weak local regions; behavioral targets remain roughly 4.5:1 across most sampled areas and avoiding materially weak regions around 3:1 when a stronger candidate exists.
- Readable outline remains proportional to glyph size and may escalate within safe limits that preserve Thai glyph counters and tone marks.
- Later safety escalation remains normal outline → thicker outline → controlled Shadow/Halo → Background Plate where allowed.
- Automatic Background Plate remains restricted to Overlay Subtitle. Dialogue and Narration / Panel Caption use the strongest non-plate candidate and review-required state if still insufficient.
- Validated SFX / Decorative source effects remain source-faithful; once a decorative region enters Readable fallback, uncertain gradient/glow/shadow is simplified rather than guessed.
- Auto remains Auto when fallback occurs and exposes `Auto → Readable fallback` plus a reason. Explicit Readable uses Binary Fill directly. Manual remains fully user-owned.
- Auto/Readable recompute after committed layout changes that alter the Translated glyph footprint; they do not recompute every pointer frame. Manual is never adaptively rewritten.
- Style/readability failure remains non-fatal to single-page and batch translation.
- Workspace and export consume the same final resolved style, fallback provenance, escalation state, and review state.

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

Adaptive Readable + Outline wave (closed):
- `13` Adaptive Readable on Bright & White Backgrounds
- `14` Mixed-Background Readability Scoring & Outline Escalation
- `15` Readability Halo, Overlay Plate & Review Escalation
- `16` Layout-Commit Adaptive Recalculation & Ownership Persistence
- `17` Adaptive Readable Regression & Export Parity

Binary Fill + Source Outline wave (closed):
- `18` Binary Fill Readable Foundation — [CLOSED]
- `19` Brightness Classification & Outline Strengthening — [CLOSED]
- `20` Background-Aware Binary Readability Gate — [CLOSED]
- `21` Binary Fill Ownership, UI State & Persistence — [CLOSED]
- `22` Binary Fill Regression, Batch & Export Parity — [CLOSED]

Current frontier: All tickets in the wave (18–22) are completed and closed.

## Fog

- The exact numeric luminance boundary between light, dark, and ambiguous Source accents remains an implementation choice; behavior must be testable without hard-coding one private threshold into the public contract.
- The exact color-space method used to strengthen Source-accent outlines remains an implementation choice as long as hue is preserved where practical and the final result passes Readability.
- The exact contrast metric, lower-percentile calculation, and sampling density remain implementation choices within the established behavior targets.
- The exact visual cap for outline thickness may depend on font/glyph metrics; it must preserve Thai glyph counters and tone marks.
- The exact shape/opacity of the final Overlay Subtitle background plate remains an implementation choice as long as it is only reached after earlier Binary Fill safety stages fail and workspace/export parity is preserved.
