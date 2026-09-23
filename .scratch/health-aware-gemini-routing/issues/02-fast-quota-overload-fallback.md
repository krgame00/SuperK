# 02: Fast Quota & Overload Fallback

**What to build:** Make Gemini routing react to provider failures at the narrowest correct scope so Auto stops wasting time on routes that are already known to be unavailable. Quota failures should cool down only one model+key route, clear high-demand responses should skip the rest of that model immediately, generic server failures may retry once, and the direct image request must remain inside the agreed time budget.

**Blocked by:** 01: Shared Image Router + Ownership-Preserving Key Pool

**Status:** ready-for-agent

- [ ] A `429` creates cooldown only for the failing model+key route.
- [ ] Provider `Retry-After` is honored when present; otherwise the route uses the agreed 60-second fallback cooldown.
- [ ] A clear `503 High demand` skips all remaining key routes for that model after the first overload response.
- [ ] A clear `503 High demand` creates a 30-second model-wide overload cooldown without marking the model incompatible.
- [ ] Generic `500/502` may retry the same route once before fallback and does not create model-wide overload state by default.
- [ ] Timeout, transport, quota, and overload failures do not poison workflow compatibility.
- [ ] A known all-routes-unavailable/cooldown state fails fast without waiting inside the request.
- [ ] Fail-fast responses expose the earliest known retry opportunity through safe structured retry timing.
- [ ] Gemini image routing uses a 25-second per-route attempt timeout and a 60-second hard total request budget.
- [ ] Deterministic tests verify route order, skipped routes, retry timing, and that no new attempt begins after the total budget.
