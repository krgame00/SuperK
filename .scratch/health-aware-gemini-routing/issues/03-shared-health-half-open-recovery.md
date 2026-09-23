# 03: Shared Health + Half-Open Recovery

**What to build:** Share Gemini route/model health across server requests so later manga pages reuse recent failure knowledge instead of repeating it. Persist only meaningful longer-lived state, and recover overloaded models with a single real half-open trial rather than a retry burst.

**Blocked by:** 02: Fast Quota & Overload Fallback

**Status:** ready-for-agent

- [ ] Gemini route health is shared at the server/router level across page and HTTP requests.
- [ ] Quota route cooldown persists across server restart using non-secret credential identity.
- [ ] Model-wide `503` overload cooldown remains memory-only and expires after 30 seconds.
- [ ] Expired/obsolete persisted cooldown state is discarded automatically.
- [ ] When overload cooldown expires, only one request may own the Gemini model recovery trial at a time.
- [ ] Concurrent requests encountering an active recovery trial skip that model and continue to other eligible routes rather than waiting.
- [ ] A successful recovery trial reopens the model for normal routing.
- [ ] Another clear high-demand result during recovery restores a new 30-second overload cooldown.
- [ ] No periodic/background translation probe is introduced for recovery.
- [ ] Tests use fake time and concurrency-safe assertions rather than real sleeps.
