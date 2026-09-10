# 02: Bounded N+1 Clean/Translate Pipelining

**What to build:** Allow local preparation of page N+1 to overlap Gemini translation of page N while keeping cloud translation strictly serial and page-ordered. Prefetch must be bounded to one page ahead, consume a valid prepared result without repeating cleaning, preserve existing retry/quota semantics, and stop creating new work immediately when the batch is cancelled.

**Blocked by:** 01: Prepared-page Identity & Reusable Clean Asset.

**Status:** implemented (frontend verified)

**Evidence (2026-09-10):** `handleTranslateAll` snapshots unfinished work, permits one N+1 preparation, consumes the prepared promise in order, keeps Gemini serial, isolates preparation failures, and stops new work after cancellation. Full Vitest regression passed (94 files / 460 tests).

- [ ] While Gemini translation for page N is in flight, local preparation for page N+1 may start concurrently.
- [ ] Page N+2 cannot begin local preparation before the Batch progress frontier advances and N+2 becomes the next-page candidate.
- [ ] Gemini never has more than one in-flight translation request and request order remains the selected page order.
- [ ] When page N+1 reaches its normal translation turn and its Prepared-page identity still matches, the prefetched clean result is consumed without repeating local preparation.
- [ ] A source, mask, or cleaning-policy revision detected before consumption causes the stale prefetched result to be rejected and the current revision to be prepared instead.
- [ ] A prefetch failure is isolated to that page and does not roll back or discard a successful translation of the previous page.
- [ ] Cancelling the batch stops current/queued cloud translation work and prevents any new prefetch from starting.
- [ ] Local inference already running at cancellation may finish safely, but its completion cannot advance the cancelled batch, start translation, or trigger another prefetch.
- [ ] A valid late local completion after cancellation may still be promoted to the reusable clean asset defined by Ticket 01.
- [ ] Existing group-targeted retry behavior, failure grouping, and quota cooldown semantics remain unchanged by pipelining.
- [ ] Tests drive the batch orchestration seam and prove overlap, one-page prefetch bound, serial Gemini concurrency, ordered requests, reuse, invalidation, cancellation, late completion, and failure isolation.
