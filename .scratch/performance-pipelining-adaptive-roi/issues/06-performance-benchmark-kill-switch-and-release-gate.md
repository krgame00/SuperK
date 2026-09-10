# 06: Performance Benchmark, Kill Switch & Release Gate

**What to build:** Prove that Prepared-page pipelining and Adaptive cleaning scope materially reduce wall-clock time without regressing quality, safety, or memory, then make the optimized path the default only when the release gates pass. Preserve an internal diagnostic fallback that can restore sequential batch orchestration and full-page cleaning for regression investigation without exposing architecture controls to normal users.

**Blocked by:** 01: Prepared-page Identity & Reusable Clean Asset; 02: Bounded N+1 Clean/Translate Pipelining; 03: Quality-First Adaptive ROI Cleaning; 04: Bounded ROI Escalation & Page Awaiting Review; 05: Truthful Batch Progress & Rolling ETA.

**Status:** blocked (benchmark corpus and Python test runner unavailable)

**Evidence (2026-09-10):** optimized behavior is release-gated and disabled by default. Internal opt-in flags are `SUPERK_ENABLE_ADAPTIVE_ROI` for the service and `superk:enable-performance-pipeline` for bounded prefetch; `SUPERK_DISABLE_ADAPTIVE_ROI` and `superk:legacy-performance-mode` retain diagnostic fallbacks. TypeScript, full frontend regression, Python compilation, and deterministic adaptive checks pass, but the committed 30-page source corpus is unavailable and the bundled Python runtime has no `pytest`; no speedup or memory claim is recorded.

- [ ] Capture a fresh pre-optimization baseline using the existing reviewed 30-page cleaning corpus on the same machine, runtime, model set, and input identities used for the optimized comparison.
- [ ] Retain the protected corpus and existing human visual-review requirements as part of release evidence.
- [ ] Record batch wall-clock, median and p95 page duration, local cleaning time, Adaptive cleaning scope route, escalation count, LamaLarge inference count, peak RSS, residual/automatic pass rates, changed pixels outside authorized support, protected-mask changes, no-mask identity, and Page awaiting review incidence.
- [ ] Add targeted deterministic regressions for one small ROI, merged nearby masks, distributed masks, aggregate ROI full-page fallback, in-flight mask revision invalidation, bounded escalation, cancellation with in-flight prefetch, and no-mask identity.
- [ ] Optimized batch median wall-clock improves by at least 25% against the fresh baseline for the accepted benchmark workload.
- [ ] Pages routed through ROI reduce local cleaning time by at least 30% versus those same pages under their full-page baseline.
- [ ] Peak memory growth remains within approximately 25% of the fresh baseline.
- [ ] Existing quality/safety gates do not regress, including residual/automatic pass expectations, zero changes outside authorized support, zero protected-mask changes, text-free identity, rectangular-patch regression, and required visual review.
- [ ] A performance improvement that fails any quality or safety gate is treated as a failed release candidate for this feature.
- [ ] The optimized path becomes the default only after the accepted functional, performance, memory, and quality gates all pass.
- [ ] An internal diagnostic fallback can restore sequential/full-page behavior for regression investigation.
- [ ] The diagnostic fallback is not exposed as a normal user-facing tuning control in the first release.
- [ ] Release evidence reports the specific failing boundary when any gate blocks enablement, rather than claiming the optimization is ready from build/test success alone.
