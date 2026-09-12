# 01: Plain Dialogue Source Fidelity

**What to build:** Make ordinary source dialogue preserve its real visual style end-to-end. When source text is plain black or white with no outline, the translated text must remain no-outline rather than gaining a synthetic readability stroke. Source style must be recovered from the original pre-clean image, and broad Text-removal mask data must not be treated as authoritative Glyph mask evidence. High-confidence source style must survive resolution without contrast correction, and older saved style profiles must continue to render safely.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Plain black dialogue on a light speech balloon can recover a Source text style profile with black fill and explicit no-outline state.
- [x] Plain white dialogue on a dark region can recover explicit no-outline state when the source provides no stroke evidence.
- [x] High-confidence source fill and outline-presence decisions are preserved without readability-driven contrast replacement.
- [x] Text-removal mask data is never passed or interpreted as authoritative Glyph mask evidence for source-style recovery.
- [x] No-outline resolved styles render without a stroke operation in the interactive overlay.
- [x] Legacy style profiles that do not contain the new outline-presence fields remain loadable and render with backward-compatible defaults.
- [x] Regression coverage spans the confirmed Source Style Recovery, Style Resolution/Fallback Policy, and Rendered Overlay Behavior seams for this plain-dialogue path.

## Answer

Implemented the plain-dialogue source-fidelity tracer path. Source-style recovery now treats no-outline as first-class state, black and white monochrome text do not receive synthetic strokes, high-confidence resolution no longer contrast-corrects the source style, Text-removal mask data is not forwarded as Glyph mask evidence, and the overlay skips stroke rendering when `hasOutline` is false. Legacy profiles retain backward-compatible stroke defaults. Focused verification passed for color recovery, style resolution, nearby fallback, and overlay rendering.
