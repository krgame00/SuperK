# 17: Adaptive Readable Regression & Export Parity

**What to build:** Prove the complete Adaptive Readable + Outline revision against both reported failure classes: background/artwork contamination being mistaken for source style and fixed white fallback disappearing on bright backgrounds. The same final style, escalation state, ownership, review state, and fallback provenance must remain consistent across single-page translation, batch translation, workspace rendering, save/load, and export.

**Blocked by:** 13: Adaptive Readable on Bright & White Backgrounds; 14: Mixed-Background Readability Scoring & Outline Escalation; 15: Readability Halo, Overlay Plate & Review Escalation; 16: Layout-Commit Adaptive Recalculation & Ownership Persistence.

**Status:** closed

- [x] Regression coverage includes the original complex-background contamination case and proves surrounding artwork is not admitted as source style.
- [x] Regression coverage includes the reported bright/white-background case and proves Adaptive Readable does not disappear as white-on-white text.
- [x] White or near-white speech balloons resolve to a readable dark-fill outlined fallback when source-faithful admission is unavailable.
- [x] Mixed bright/dark artwork is evaluated across multiple footprint samples and remains readable without per-character color changes.
- [x] Validated source-faithful no-outline text remains no-outline and is not forced into the Adaptive Readable mandatory-outline policy.
- [x] Auto → Readable fallback preserves Auto ownership, reason, resolved candidate, and escalation state through save/load.
- [x] Explicit Readable uses the same adaptive background-aware semantics across workspace and export.
- [x] Manual styles survive re-translation, layout edits, save/load, workspace rendering, and export without automatic readability mutation.
- [x] Overlay Subtitle can reach halo/plate escalation when required, while Dialogue and Narration / Panel Caption never receive automatic plates.
- [x] Review-required state for unresolved non-plate categories remains non-fatal and persists sufficiently for later user review.
- [x] Committed layout changes recompute Auto/Readable behavior without per-frame interaction flicker.
- [x] Single-page and batch workflows use the same gating, fallback, Adaptive Readable, escalation, and ownership semantics.
- [x] Workspace rendering and export visibly match for fill, outline, outline ratio, halo/shadow, optional Overlay Subtitle plate, and opacity.
- [x] The full revision is verified through exactly the three confirmed seams: Source Style Recovery + Evidence Admission; Style Resolution + Readability/Fallback Policy; Overlay/UI/Export Behavior.
- [x] Relevant unrelated translation/export regressions remain green after integration.
