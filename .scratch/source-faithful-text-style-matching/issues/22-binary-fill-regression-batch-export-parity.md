# 22: Binary Fill Regression, Batch & Export Parity

**What to build:** Prove the complete Binary Fill + Source Outline revision against the real failure classes that motivated the styling work: contaminated source-color sampling, white fallback disappearing on bright backgrounds, and unstable chromatic fallback styling. The reviewed result must remain equivalent across single-page translation, batch translation, persistence, workspace rendering, and export.

**Blocked by:** 18: Binary Fill Readable Foundation; 19: Brightness Classification & Outline Strengthening; 20: Background-Aware Binary Readability Gate; 21: Binary Fill Ownership, UI State & Persistence.

**Status:** closed

- [x] Regression coverage still proves surrounding artwork/background colors are not admitted as validated source styling merely because they dominate an OCR region.
- [x] Readable fallback fill is always pure white or pure black across regression fixtures; chromatic fallback fill cannot reappear through another workflow.
- [x] White/near-white speech-balloon regression coverage proves fallback text remains readable rather than disappearing white-on-white.
- [x] Dark-background regression coverage proves the system can reject black fill and choose a stronger white Binary Fill candidate.
- [x] Pastel/light Source accents can remain recognizable in strengthened outlines without sacrificing readability.
- [x] Dark/near-black Source accents follow the confirmed preferred mapping while still allowing Readability-gate rejection when the background demands another pair.
- [x] Mixed bright/dark artwork remains readable through one resolved binary fill/outline style without per-character recoloring.
- [x] Validated source-faithful chromatic and decorative styling remains source-faithful and is not flattened simply because Binary Fill exists.
- [x] Validated source-faithful no-outline styling remains reachable and is not forced into Readable mandatory outline.
- [x] Decorative regions that actually enter Readable fallback are simplified to Binary Fill + readable outline instead of uncertain source gradient/glow/shadow reproduction.
- [x] Auto → Readable fallback retains Auto ownership, reason, and resolved style across save/load and re-translation.
- [x] Manual styles remain identical through re-translation, layout changes, persistence, workspace rendering, and export.
- [x] Single-page and batch workflows apply the same source admission, fallback chain, Binary Fill mapping, Readability gate, and ownership semantics.
- [x] Workspace rendering and export visibly match for binary fill, outline color/strength, outline ratio, opacity, and any later readability halo/Overlay Subtitle plate state.
- [x] Style/readability failure remains non-fatal and review-required state remains available where applicable.
- [x] The complete revision is covered through exactly the three confirmed seams: Source Style Recovery + Evidence Admission; Style Resolution + Readability/Fallback Policy; Overlay/UI/Export Behavior.
- [x] Relevant unrelated translation/export regressions remain green after integration.

