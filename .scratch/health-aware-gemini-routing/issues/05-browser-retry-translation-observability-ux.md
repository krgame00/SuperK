# 05: Browser Retry + Translation Observability UX

**What to build:** Stop the browser from multiplying a completed server fallback tree and make Auto fallback understandable without exposing internal noise. Automatic client retry should happen only for genuine network/transport failure, while the workspace shows concise fallback progress and safe final observability.

**Blocked by:** 02: Fast Quota & Overload Fallback; 04: Adaptive Auto Ranking

**Status:** ready-for-agent

- [ ] Browser-level automatic retry performs at most one additional attempt for genuine network/transport failure.
- [ ] Quota, model overload, router timeout, incompatibility, Manual route exhaustion, and known cooldown do not trigger a full automatic server-routing retry loop.
- [ ] User-initiated retry remains available after actionable failures.
- [ ] During Auto fallback, the workspace shows concise progress that Auto is switching to an available model rather than appearing frozen.
- [ ] Successful translation can surface selected model, elapsed time, and fallback count without exposing credential secrets.
- [ ] Observability supports provider, model, ownership, non-secret key identity, attempt count, fallback count, elapsed time, skipped-route count, final error, and cooldown reason where available.
- [ ] Final error reporting favors the actionable final routing state rather than blindly returning the first provider error.
- [ ] Raw API keys never appear in browser state, diagnostics, logs captured by tests, or responses.
- [ ] Workflow tests prove the browser cannot turn one completed server routing pass into three full passes.
