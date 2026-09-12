# 12: Reported-Regression E2E & Export Parity

**What to build:** Prove the complete revised source-style policy against the real failure pattern that triggered this revision. A wide bottom-overlay text region over complex multicolor artwork must never become hard-to-read by inheriting floor, carpet, shadow, or accent-line colors from outside the glyph evidence. The same validated/fallback result must hold in single-page translation, batch translation, persistence, workspace rendering, and export.

**Blocked by:** 08: Evidence-Gated Source Style on Complex Backgrounds; 09: Overlay Subtitle Classification & Readable Safety Path; 10: Validated Fallback Chain & Nearby Admission; 11: Auto / Readable / Manual Style Ownership UX; 06: High-Confidence Decorative Effects.

**Status:** closed

- [x] A regression fixture representing a wide bottom-overlay text region over complex multicolor artwork does not resolve surrounding artwork colors as the translated text fill or outline.
- [x] If the fixture cannot recover a trustworthy source style, it resolves to the Overlay Subtitle Readable fallback rather than an unreadable source-like guess.
- [x] The reported failure mode remains fixed even when background colors occupy more pixels in the OCR region than the actual glyphs.
- [x] Single-page translation and batch translation apply the same Source style evidence gate, category classification, readability validation, fallback chain, and ownership semantics.
- [x] Style-recovery rejection or fallback never causes an otherwise successful page translation or batch to fail.
- [x] Workspace rendering uses the same resolved style semantics that were produced by the automatic/manual ownership policy.
- [x] Export rendering uses the same resolved fill, outline presence/color/thickness, opacity, and supported effects as the workspace result the user reviewed.
- [x] An Auto → Readable fallback remains visibly equivalent after save/load and does not silently change into a different source-like color on reload.
- [x] Manual overrides continue to survive re-translation, save/load, workspace rendering, and export without automatic readability correction.
- [x] Valid high-confidence decorative text remains source-faithful when it passes the evidence/readability gates; the regression fix does not flatten every colored style into a generic preset.
- [x] Existing no-outline Dialogue behavior remains intact and is not regressed by the Overlay Subtitle safety path.
- [x] The complete revised feature is verified through exactly the three confirmed seams: Source Style Recovery + Evidence Admission; Style Resolution + Readability/Fallback Policy; Overlay/UI/Export Behavior.
- [x] Relevant unrelated translation/export regressions remain green after integration.
