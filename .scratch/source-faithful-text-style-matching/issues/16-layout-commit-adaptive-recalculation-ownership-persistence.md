# 16: Layout-Commit Adaptive Recalculation & Ownership Persistence

**What to build:** Keep Adaptive Readable correct after the user changes the translated layout. Auto and Readable regions must recompute against the new Translated glyph footprint after a committed move, resize, font-size change, or text reflow, while avoiding per-frame flicker during interaction. Ownership, fallback reason, escalation state, review-required state, and Manual overrides must survive re-rendering and persistence consistently.

**Blocked by:** 13: Adaptive Readable on Bright & White Backgrounds; 14: Mixed-Background Readability Scoring & Outline Escalation.

**Status:** closed

- [x] Auto and Readable regions recompute Adaptive Readable after a committed layout change that materially changes the Translated glyph footprint.
- [x] Moving a region can change the resolved readable candidate when the new background requires a different safe style.
- [x] Resizing, font-size changes, and text reflow can trigger the same bounded recomputation after the interaction settles.
- [x] Adaptive Readable does not recompute continuously on every pointer frame during dragging or resizing, preventing visible style flicker and unnecessary work.
- [x] Manual style is never adaptively recolored, re-outlined, or escalated after layout changes.
- [x] The application may recompute a non-mutating Manual low-contrast warning without changing the Manual profile.
- [x] Auto retains Auto ownership after recomputation even when the newly resolved result is `Auto → Readable fallback`.
- [x] Explicit Readable remains Readable after recomputation and continues to use Adaptive Readable semantics.
- [x] Fallback reason, resolved outline/escalation level, and review-required state update coherently when the footprint changes.
- [x] Save/load preserves ownership mode and enough Adaptive Readable state/provenance to reproduce the reviewed result or safely recompute it under the same layout/background.
- [x] Re-translation can update wording and reflow while preserving Manual ownership and applying the correct post-layout behavior to Auto/Readable regions.
- [x] Regression coverage exercises layout commit, persistence, and ownership through the Overlay/UI/Export Behavior seam rather than private pointer-event timing details.
