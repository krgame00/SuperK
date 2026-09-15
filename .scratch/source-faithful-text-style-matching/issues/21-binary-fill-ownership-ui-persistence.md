# 21: Binary Fill Ownership, UI State & Persistence

**What to build:** Integrate Binary Fill into the existing Auto / Readable / Manual ownership model so the selected ownership, fallback reason, Source accent/provenance, resolved black/white style, escalation state, and review state remain predictable across re-rendering, re-translation, layout edits, save, and load.

**Blocked by:** 20: Background-Aware Binary Readability Gate.

**Status:** closed

- [x] Auto uses source-faithful behavior when admitted and enters Binary Fill only after the existing automatic fallback chain is exhausted.
- [x] Auto remains the selected ownership mode when Binary Fill fallback occurs and exposes `Auto → Readable fallback` rather than silently switching ownership.
- [x] Auto fallback exposes a concise reason derived from existing provenance, such as contamination, insufficient evidence, failed readability, or no valid nearby profile.
- [x] Explicit Readable enters Binary Fill directly without presenting the result as recovered Source text style.
- [x] Manual remains fully user-owned and is not changed by Binary Fill classification, background checks, outline strengthening, or later safety escalation.
- [x] Re-translation may change translated wording while preserving ownership and Manual data; Auto/Readable remain eligible for the correct fallback recomputation.
- [x] Committed move, resize, font-size change, or reflow recomputes Auto/Readable against the changed Translated glyph footprint after interaction commit, not every pointer frame.
- [x] Manual style remains unchanged across the same layout edits, although a non-mutating low-contrast warning may be recomputed.
- [x] Save/load preserves enough state to reproduce the reviewed Binary Fill result, including ownership, fallback reason, Source accent/provenance where relevant, resolved fill/outline, escalation level, and review-required state.
- [x] Older projects without Binary Fill-specific metadata continue to load safely with backward-compatible defaults.
- [x] Workspace state does not silently convert a Binary Fill fallback back into chromatic source-like fill after reload or re-translation.
- [x] Tests cover ownership, persistence, re-translation, and committed-layout behavior through the Style Resolution + Readability/Fallback Policy and Overlay/UI/Export Behavior seams.

