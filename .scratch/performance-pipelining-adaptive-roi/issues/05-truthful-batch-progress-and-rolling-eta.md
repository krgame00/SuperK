# 05: Truthful Batch Progress & Rolling ETA

**What to build:** Make batch progress and remaining-time feedback truthful once different pages can be at different pipeline stages. Primary progress must follow the Batch progress frontier, while N+1 preparation is shown only as secondary status. ETA should remain in an estimating state until enough end-to-end samples exist, then adapt to recent throughput without multiplying one-time warm-up, quota waits, or user-review waits across the remaining batch.

**Blocked by:** 02: Bounded N+1 Clean/Translate Pipelining; 04: Bounded ROI Escalation & Page Awaiting Review.

**Status:** implemented (frontend regression verified)

**Evidence (2026-09-10):** progress exposes secondary prefetch status and estimating state, excludes warm-up and retry/quota waits from rolling samples, removes already-completed pages from the batch work set and ETA denominator, and keeps the primary frontier at the first failed/unready page. Full Vitest regression passed (94 files / 460 tests).

- [ ] Primary progress is derived from the earliest selected page that is not yet fully ready for the user, not from the highest page that has started local preparation.
- [ ] A prefetched N+1 page does not advance the primary percentage merely because its cleaning started or completed.
- [ ] Prefetch is surfaced as secondary status so the UI can distinguish the page currently being translated from the next page being prepared.
- [ ] Before at least two pages complete end-to-end, the UI reports that remaining time is still being estimated instead of presenting a numeric ETA.
- [ ] After enough samples exist, ETA is calculated from a rolling window of the five most recently completed end-to-end page durations.
- [ ] One-time model/runtime warm-up is excluded from projected per-page throughput.
- [ ] Quota cooldown/wait intervals are excluded from projected processing ETA.
- [ ] Page awaiting review/user-wait intervals are excluded from projected processing ETA.
- [ ] ETA responds to recent workload changes rather than being permanently distorted by unusually slow startup pages.
- [ ] Cancellation clears active batch progress/prefetch presentation without allowing a late local completion to make the cancelled batch appear to advance.
- [ ] Failure isolation remains reflected correctly in progress when one page is awaiting review and unrelated pages continue.
- [ ] Workspace-level tests cover concurrent translation/prefetch presentation, frontier-based progress, estimating state, rolling ETA, excluded wait classes, cancellation, and Page awaiting review interaction.
