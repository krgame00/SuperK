# 11: Auto / Readable / Manual Style Ownership UX

**What to build:** Make style ownership visible and predictable to the user. Auto should continue to mean automatic source-style matching even when the automatic pipeline falls back to a Readable style; Readable should be an explicit user-selectable safe preset; Manual should remain fully user-owned and must never be silently rewritten by automatic evidence or readability gates. The selected ownership mode and fallback explanation must survive re-rendering, re-translation, save, and load.

**Blocked by:** 09: Overlay Subtitle Classification & Readable Safety Path; 10: Validated Fallback Chain & Nearby Admission; 05: Persistent Manual Style Ownership.

**Status:** closed

- [x] Auto remains the selected ownership mode when automatic resolution falls back; the UI can communicate `Auto → Readable fallback` rather than silently switching ownership to Readable.
- [x] Auto fallback exposes a concise reason derived from fallback provenance, such as background contamination, insufficient source evidence, low confidence, low readability, or no valid nearby anchor.
- [x] The user can explicitly select a Readable mode that applies the category-appropriate safe style without pretending it is recovered source style.
- [x] The user can explicitly select Manual mode and own the complete style profile, including fill, outline presence/color/thickness, opacity, and supported decorative effects.
- [x] Manual style is not altered by Source style evidence gating, readability fallback, re-analysis, nearby inheritance, re-rendering, or re-translation.
- [x] If a Manual style has poor contrast, the application may warn the user but does not automatically rewrite the chosen style.
- [x] The user can explicitly return from Manual or Readable to Auto/Original behavior; automation never silently reclaims a Manual override.
- [x] Re-translation can update translated wording while preserving the bubble's ownership mode and Manual style data.
- [x] Save/load persistence retains Manual ownership and its complete profile, and retains enough Auto fallback state/provenance to explain the current visible result after reload where applicable.
- [x] Older projects without the newer ownership/fallback metadata remain loadable with backward-compatible behavior.
- [x] Overlay Subtitle Readable fallback and existing Dialogue no-outline source fidelity both remain reachable through the same ownership model without one policy leaking into the other.
- [x] Regression coverage verifies externally visible mode, resolved style, persistence, and re-translation behavior through the Style Resolution + Readability/Fallback Policy and Overlay/UI/Export Behavior seams.
