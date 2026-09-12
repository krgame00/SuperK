# 10: Validated Fallback Chain & Nearby Admission

**What to build:** Make automatic style fallback deterministic and safe. A bubble should first use its own validated source style, then receive one bounded local re-analysis, then consider a validated Nearby color profile from the same Text style category, and only then use a category-appropriate Readable fallback style. Nearby style must never be admitted solely because it is close or numerically high-confidence.

**Blocked by:** 08: Evidence-Gated Source Style on Complex Backgrounds; 09: Overlay Subtitle Classification & Readable Safety Path.

**Status:** closed

- [x] Automatic style resolution follows the agreed order: own validated source → bounded local re-analysis → validated same-category nearby → Readable fallback.
- [x] High-confidence automatic profiles still require Source style evidence gate admission and readability validation before direct rendering.
- [x] Medium-confidence profiles receive one bounded local re-analysis before nearby or Readable fallback and do not trigger an additional cloud request.
- [x] Low-confidence profiles do not render weak source-color guesses.
- [x] A Nearby color profile is eligible only when its Source text style profile has already passed source-evidence validation.
- [x] Nearby candidates must also remain legible for the target region; an unreadable nearby style is rejected instead of inherited.
- [x] Nearby inheritance requires compatible canonical categories before spatial distance is considered.
- [x] Dialogue, Narration / Panel Caption, SFX / Decorative, and Overlay Subtitle do not inherit across category boundaries solely because they are spatially close.
- [x] If multiple validated same-category nearby candidates exist, bounded spatial proximity is used only as a secondary selector after validation and category compatibility.
- [x] If no candidate survives the chain, the target receives its category-appropriate Readable fallback style with explicit fallback provenance.
- [x] Fallback provenance distinguishes own-source rejection, re-analysis failure, nearby inheritance, and final Readable fallback sufficiently for later UI explanation.
- [x] Existing successful same-category nearby inheritance remains supported for trustworthy source styles.
- [x] Regression coverage verifies the chain through the Style Resolution + Readability/Fallback Policy seam without asserting internal helper order beyond the externally observable precedence contract.
