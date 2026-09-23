# 07: Chrome Extension Parity + Release Regression Gate

**What to build:** Finish the feature by making Chrome Extension translation behavior follow the same shared server routing semantics as the main workspace and by running the complete cross-surface regression gate. Remove or subordinate any extension-side canonical fallback hierarchy that can contradict server health decisions without rewriting unrelated extension behavior.

**Blocked by:** 05: Browser Retry + Translation Observability UX; 06: Settings Health & Manual Recovery UI

**Status:** ready-for-agent

- [ ] Extension translation uses the shared server routing/model-health semantics when SuperK is available.
- [ ] No independent canonical extension fallback hierarchy can override server route health or model ordering.
- [ ] Existing extension transport/integration behavior unrelated to routing remains intact.
- [ ] Cross-surface tests cover `429` route cooldown, `503 High demand` model skip, 30-second overload cooldown, half-open recovery, Manual model contract, Last-known-good behavior, and 60-second server budget.
- [ ] Regression tests prove browser retry does not multiply server fallback work.
- [ ] Regression tests prove Settings and Extension do not expose raw API keys in diagnostics or UI state.
- [ ] Existing request validation, safety handling, cancellation, response parsing, stale catalog fallback, and unrelated workspace/extension tests remain green.
- [ ] Typecheck, targeted routing/UI/extension tests, and the full project test suite pass before release.
- [ ] A final verification run confirms the original minute-scale failure mode is structurally prevented: known cooldowns fail fast and one clear high-demand response never burns every key for the same model.
