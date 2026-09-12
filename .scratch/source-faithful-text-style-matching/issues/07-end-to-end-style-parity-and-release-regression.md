# 07: End-to-End Style Parity & Release Regression

**What to build:** Prove that source-faithful style semantics are consistent across the full user workflow. Single-page translation, batch translation, manual editing/resizing, on-screen overlay rendering, saved projects, and export must resolve and render the same Source text style profile so the exported page matches what the user reviewed in the workspace.

**Blocked by:** 02: Source-Derived Outline Fidelity; 03: Confidence Bands & Non-Fatal Style Recovery; 04: Category-Safe Nearby Style Fallback; 05: Persistent Manual Style Ownership; 06: High-Confidence Decorative Effects.

**Status:** ready-for-agent

- [x] Single-page translation uses the same source-faithful style semantics as batch translation.
- [x] Bubble movement, resizing, and text re-layout do not discard the recovered or manually owned style profile.
- [x] Workspace rendering and export rendering use the same resolved fill, outline-presence, outline-thickness, opacity, and supported decorative-effect semantics.
- [x] An exported page visually follows the same resolved style state the user reviewed in the workspace.
- [x] Legacy profiles and fallback-styled bubbles continue to render successfully during normal workspace use and export.
- [x] The complete feature is covered through exactly the three confirmed behavior seams: Source Style Recovery, Style Resolution/Fallback Policy, and Rendered Overlay Behavior.
- [x] Regressions cover plain no-outline dialogue, true outlined text, confidence fallback, category-safe inheritance, persistent manual override, and decorative effect gating.
- [x] Existing unrelated translation and export workflows remain green after the source-faithful style changes are integrated.
