# 09: Overlay Subtitle Classification & Readable Safety Path

**What to build:** Treat bottom-of-panel or artwork-overlaid subtitle text as its own Text style category rather than confusing it with Dialogue or Narration / Panel Caption. Overlay Subtitle regions should still use validated source style when trustworthy, but when source evidence or readability validation fails they must degrade to a category-appropriate Readable fallback style that stays legible over complex artwork without changing valid source-faithful dialogue elsewhere.

**Blocked by:** 08: Evidence-Gated Source Style on Complex Backgrounds; 04: Category-Safe Nearby Style Fallback.

**Status:** closed

- [x] Text metadata and style resolution can distinguish Overlay Subtitle from Dialogue, Narration / Panel Caption, and SFX / Decorative.
- [x] Wide, relatively shallow text regions over artwork can be treated as Overlay Subtitle when existing category evidence identifies that role; the change does not require a new cloud request solely for style classification.
- [x] A validated Overlay Subtitle Source text style profile is preserved when it passes both the Source style evidence gate and readability validation.
- [x] An Overlay Subtitle candidate that fails evidence validation or local readability validation does not render the rejected source-like color.
- [x] The default Readable fallback style for Overlay Subtitle uses a light fill, dark outline, explicit outline presence, full opacity, and a category-appropriate outline proportion suitable for variable artwork.
- [x] Readable fallback is marked as fallback and is never mislabeled as a recovered Source text style profile.
- [x] Existing plain Dialogue with validated no-outline source evidence remains no-outline; the Overlay Subtitle safety policy does not globally reintroduce forced outlines.
- [x] Narration / Panel Caption and Overlay Subtitle remain distinct canonical categories in persistence, fallback logic, and user-visible state.
- [x] Legacy profiles that still use older category metadata continue to load safely and are not silently cross-inherited as Overlay Subtitle.
- [x] Regression coverage proves that the reported bottom-overlay case remains readable when source sampling is contaminated by the underlying artwork.
- [x] Tests use the confirmed Source Style Recovery + Evidence Admission and Style Resolution + Readability/Fallback Policy seams rather than private UI heuristics.
