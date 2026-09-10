# 0005. Bounded Prepared-Page Prefetch and Adaptive Cleaning Scope

Date: 2026-09-10

## Status

Accepted

## Context

Batch translation currently spends too much wall-clock time waiting for local cleaning and cloud translation in sequence, while full-page neural inpainting can be wasteful when text-removal masks occupy only localized parts of a manga page. The optimization must reduce elapsed time without increasing Gemini request concurrency, silently weakening cleaning quality, or introducing unbounded local neural work.

## Decision

1. **Bounded Clean/Translate Pipeline**
   Keep Gemini translation ordered and single-request-at-a-time. While page N is being translated, allow local preparation of page N+1 only. Do not prefetch N+2 and do not translate ahead.

2. **Prepared Result Reuse**
   A completed prepared page is reusable across cancellation and application restart while its Prepared-page identity still matches. Identity is content-aware: source image revision, text-removal mask revision, and cleaning policy/model revision must match. Translation-only settings such as glossary changes do not invalidate the clean image. Reuse the existing clean-page asset/cache rather than creating a second large cache.

3. **Quality-First Adaptive Cleaning Scope**
   Decide between localized ROI inpainting and full-page inpainting using normalized page-relative metrics such as mask coverage, spatial spread, cluster count, and aggregate ROI area. Nearby or overlapping regions may be merged, but if merged ROI area becomes too large the policy selects full-page cleaning instead. Thresholds are internal deterministic policy calibrated by benchmark, not user-facing tuning controls in the first release.

4. **Bounded Quality Escalation**
   A prepared-page revision may use at most three quality attempts: normal/merged ROI, expanded ROI, then full-page LamaLarge. Each transition is driven by the existing verification/residual guard. Failure after the full-page attempt moves that page to Page awaiting review; the failed page is not automatically translated, while unrelated pages may continue.

5. **Cancellation and Failure Isolation**
   Cancel stops cloud translation and prevents new local preparation from starting immediately. A local neural inference already running may finish safely; a successful late result may be promoted to the reusable prepared asset, but it must not advance the cancelled batch or start another prefetch. A prefetch failure is isolated to that page and does not discard an already successful translation of the previous page.

6. **Progress and ETA**
   Primary progress follows the Batch progress frontier, not the highest page that has started. Prepared-page prefetch is shown as secondary status. Before two pages complete end-to-end, ETA is reported as still being estimated. Thereafter ETA uses a rolling window of the five most recently completed pages and excludes one-time warm-up, quota waits, and user-review waits from projected processing throughput.

7. **Performance Release Gate**
   Measure against a fresh pre-optimization baseline on the same 30-page cleaning corpus, machine, runtime, and inputs. The optimized implementation must preserve existing quality/safety gates, reduce batch median wall-clock by at least 25%, reduce cleaning time by at least 30% on pages routed through ROI versus their full-page baseline, and keep peak memory growth within approximately 25%. Add targeted regressions for single/merged/distributed ROI, full-page threshold fallback, mask-revision invalidation, bounded escalation, cancellation, and no-mask pixel identity.

8. **Operational Fallback**
   After benchmark gates pass, enable the optimization by default but retain an internal diagnostic kill switch that can restore sequential/full-page behavior for regression investigation. Do not expose architecture-level tuning controls to normal users in the first release.

## Consequences

- **Positive**: Local cleaning time can overlap cloud latency without increasing Gemini concurrency or quota pressure.
- **Positive**: Localized pages avoid unnecessary full-page LamaLarge inference while quality verification retains a bounded path back to full-page reconstruction.
- **Positive**: Prepared results survive cancellation and restart when still semantically valid, reducing repeated expensive cleaning.
- **Trade-off**: Translation orchestration must track one bounded in-flight prepared page, revision-aware cache identity, and independent page-level preparation failures.
- **Trade-off**: Adaptive thresholds require benchmark calibration and must remain deterministic enough for regression testing.
- **Trade-off**: Some pages will deliberately keep the slower full-page path when ROI confidence or verification is insufficient; speed never overrides the authorized cleaning mask or quality guard.
