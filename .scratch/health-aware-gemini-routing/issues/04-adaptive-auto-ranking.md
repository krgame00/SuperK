# 04: Adaptive Auto Ranking

**What to build:** Make Auto prefer routes that have recently proven healthy and fast for the current workflow without turning those observations into permanent model pinning. Last-known-good and successful latency should guide ordering only after compatibility, health, and release-channel policy are satisfied.

**Blocked by:** 02: Fast Quota & Overload Fallback

**Status:** ready-for-agent

- [ ] Last-known-good remains workflow-specific and is updated only after a successful translation satisfying that workflow.
- [ ] Last-known-good model identity and latest success time persist safely across restart.
- [ ] Last-known-good priority remains fresh for 24 hours and then falls back to normal ranking.
- [ ] Health, compatibility, credential eligibility, and release-channel policy rank ahead of latency.
- [ ] Healthy compatible stable models can be ordered by bounded recent successful latency using a rolling/EWMA-style signal.
- [ ] One latency outlier cannot permanently dominate ordering.
- [ ] Preview/experimental models remain excluded from Auto unless the existing preview opt-in permits them.
- [ ] Transient failure latency does not mark a model incompatible or permanently demote it.
- [ ] Tests verify fresh versus expired Last-known-good, persisted state, latency reordering, preview policy, and compatibility precedence.
