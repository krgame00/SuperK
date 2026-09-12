# 06: Performance Benchmark, Kill Switch & Release Gate

**What to build:** Prove that Prepared-page pipelining and Adaptive cleaning scope materially reduce wall-clock time without regressing quality, safety, or memory, then make the optimized path the default only when the release gates pass. Preserve an internal diagnostic fallback that can restore sequential batch orchestration and full-page cleaning for regression investigation without exposing architecture controls to normal users.

**Blocked by:** 01: Prepared-page Identity & Reusable Clean Asset; 02: Bounded N+1 Clean/Translate Pipelining; 03: Quality-First Adaptive ROI Cleaning; 04: Bounded ROI Escalation & Page Awaiting Review; 05: Truthful Batch Progress & Rolling ETA.

**Status:** blocked (exploratory corpus is not release-reviewed; optimized path fails performance and memory gates)

**Evidence (2026-09-10):** optimized behavior is release-gated and disabled by default. A new exploratory run used the same 42 pages (including 8 English pages) from `F:\SuperKC` for both modes. Legacy median/p95 were `18,083/28,957 ms` with peak RSS `2,393.5 MB`; optimized median/p95 were `24,983/38,636 ms` with peak RSS `3,608.0 MB` (+38.15% median time, +33.43% p95, +50.74% RSS). Residual/automatic pass stayed `96.5%`, changed pixels outside support and inside protected stayed `0`, and awaiting-review pages stayed `7`; visual review evidence is empty, so this is exploratory evidence and the release gate remains blocked.

**Regression safety update (2026-09-11):** the failed experiment is now harder-gated so stale debug settings cannot accidentally reactivate it. Production falls back to legacy full-page cleaning and sequential batch orchestration unless new explicit experimental flags are set: `SUPERK_ENABLE_ADAPTIVE_ROI_V2=1` and `superk:experimental-performance-pipeline-v2=1` (or `NEXT_PUBLIC_ENABLE_PERFORMANCE_PIPELINE_V2=1`). When Adaptive ROI is disabled, the production pipeline now skips Adaptive-scope clustering entirely. Workspace preparation also reuses validated in-memory clean results directly and avoids re-fetching/re-hashing immutable Blob/data sources. The legacy diagnostic disables remain available.

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
