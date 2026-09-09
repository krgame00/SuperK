# 04: Enforce Quota Cooldown Retry

**What to build:** When Gemini returns a quota or rate-limit failure, the translator sees a reliable cooldown countdown and can manually retry the affected pages only after the cooldown expires. The application does not send another request merely because the timer reaches zero.

**Blocked by:** 02: Classify Cleaner Failures

**Status:** in-review

- [x] A 429 response is classified as `QUOTA_EXHAUSTED` and carries normalized retry timing metadata.
- [x] Delay-seconds and HTTP-date `Retry-After` values are accepted and converted to a bounded cooldown duration.
- [x] Missing, malformed, or extreme provider timing uses a documented safe default and cannot create an unbounded wait.
- [x] The workspace stores an absolute cooldown expiry so rerenders and closing/reopening the diagnostic view do not reset it.
- [x] Quota retry controls remain disabled and show remaining time while cooldown is active.
- [x] The retry control becomes available when cooldown expires, but no request is sent until the user clicks it.
- [x] Manual retry targets only pages in the associated quota failure group.
- [x] Repeated quota responses may extend an active cooldown but cannot shorten it.
- [ ] API contract and workspace workflow tests use a controllable clock and verify all timing branches without waiting in real time. *(Parser unit coverage is present; full workspace timing coverage remains.)*
