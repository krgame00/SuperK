# 06: Settings Health & Manual Recovery UI

**What to build:** Make Settings tell the truth about credentials and model health. Valid credentials, quota, overload, cooldown, compatibility, and Manual recovery should be presented as distinct states, with compact aggregate information by default and safe advanced detail when troubleshooting.

**Blocked by:** 02: Fast Quota & Overload Fallback; 03: Shared Health + Half-Open Recovery; 04: Adaptive Auto Ranking

**Status:** ready-for-agent

- [ ] Settings reports Gemini credential validity separately from model/route health.
- [ ] Aggregate credential status may show values such as `8/8 valid` without implying every model has quota.
- [ ] Model health can distinguish ready, partially quota-limited, high demand, cooldown, incompatible, and unverified where applicable.
- [ ] Default Settings presentation remains compact; advanced detail may show model/key-slot health using non-secret identity only.
- [ ] Catalog refresh updates discovery and expired state without issuing translation probes against every model/key combination.
- [ ] If an explicit per-model test action exists, it spends quota only when deliberately invoked by the user.
- [ ] A saved unavailable Manual model remains visible with its truthful state instead of being silently rewritten.
- [ ] Manual route exhaustion/high-demand/quota failure fails fast with reason and retry timing where known.
- [ ] Manual failure offers an explicit switch-to-Auto action rather than silently substituting a model.
- [ ] UI tests verify wording/behavior for credential validity, health states, advanced detail, refresh, unavailable Manual models, and switch-to-Auto recovery.
