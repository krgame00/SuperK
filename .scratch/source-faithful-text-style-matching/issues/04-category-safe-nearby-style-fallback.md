# 04: Category-Safe Nearby Style Fallback

**What to build:** Restrict Nearby color profile inheritance to visually compatible text roles. Dialogue, Narration/Caption, and SFX/Decorative become canonical Text style categories, and spatial proximity is used only after category compatibility is established so ordinary dialogue cannot inherit a nearby decorative SFX style by accident.

**Blocked by:** 03: Confidence Bands & Non-Fatal Style Recovery.

**Status:** resolved

- [x] Source-style profiles can carry one of the canonical categories Dialogue, Narration/Caption, or SFX/Decorative when category information is available.
- [x] Nearby fallback considers category compatibility before distance.
- [x] Dialogue cannot inherit style from SFX/Decorative solely because it is the closest high-confidence region.
- [x] Narration/Caption does not inherit from an incompatible category solely due to proximity.
- [x] Compatible nearby regions can still provide fallback style when confidence is low and distance is within the existing bounded neighborhood policy.
- [x] Existing profiles without category metadata degrade safely without project-load failure.
- [x] Regression coverage includes same-category inheritance and explicit cross-category rejection.

## Answer

Implemented category-safe Nearby color profile inheritance. The resolver recognizes Dialogue, Narration/Caption, and SFX/Decorative metadata, only uses high-confidence anchors of the same known category, and treats distance as a secondary selector. The existing image-translation request now asks Gemini to return `styleCategory` in the same request (no additional API call), while legacy/unknown profiles safely avoid cross-category inheritance. Focused nearby-fallback and route-contract tests pass.
