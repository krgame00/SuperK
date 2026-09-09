# 05: Enforce Group-Scoped Quota Cooldown

**What to build:** When Gemini returns a quota or rate-limit failure, one stable quota failure group owns the cooldown for its exact page set. The translator sees the remaining wait, cannot retry that group early, and can manually retry only those pages after the cooldown expires.

**Blocked by:** 01: Establish Stable Failure Groups

**Status:** closed

- [x] A quota/rate-limit response is classified as `QUOTA_EXHAUSTED` and carries normalized retry timing metadata to the workspace.
- [x] Delay-seconds and HTTP-date `Retry-After` values are accepted and converted to a bounded absolute expiry time.
- [x] Missing, malformed, negative, past, or extreme provider timing uses the documented bounded fallback behavior.
- [x] Cooldown state belongs to the stable quota failure group rather than one global workspace timer.
- [x] All pages captured by one quota failure group share one cooldown expiry and one retry action.
- [x] Closing/reopening diagnostics and ordinary rerenders preserve the group's absolute expiry.
- [x] Retry remains disabled and displays the remaining wait while the group cooldown is active.
- [x] Cooldown expiry enables retry but does not send an API request automatically.
- [x] Manual retry targets only the page set captured by that quota failure group.
- [x] Repeated quota responses may extend the group's expiry but cannot shorten an already active cooldown.
- [x] A controllable-clock workspace/API test covers provider timing branches, countdown, expiry, no auto-retry, and exact targeted retry without real-time waits.
