# 0004. Granular Translation Failure Diagnostics and Automatic Environment Forwarding

Date: 2026-09-09

## Status

Accepted — amended 2026-09-09

## Context

Batch translation failures previously collapsed multiple causes into a generic retry message. The diagnostic system was introduced to distinguish missing credentials, quota exhaustion, safety filtering, local cleaner availability, and network problems and to give the user a recovery action appropriate to the root cause.

Release-readiness review exposed two additional requirements. A running local sidecar whose cleaner/model fails is not the same condition as an offline sidecar, and an action cannot be considered actionable if its page set or cooldown silently changes while the user is reviewing it. Recovery also must not imply automatic retry when the action's purpose is only to repair a dependency.

## Decision

1. **Structured Failure Classification**
   Use the canonical diagnostic taxonomy:
   - `MISSING_KEY`: no usable Gemini API key is available.
   - `QUOTA_EXHAUSTED`: Gemini quota/rate limit is exhausted and retry timing applies.
   - `SAFETY_BLOCKED`: upstream safety handling rejected the request/image.
   - `LOCAL_SIDECAR_OFFLINE`: the managed local Python service is unreachable, unhealthy, stopped, or unable to become healthy.
   - `LOCAL_CLEANER_FAILED`: the local service is reachable but cleaner/model loading or inference fails.
   - `NETWORK_OR_TIMEOUT`: a non-local network request or timeout failure prevents translation.
   - Unknown classification is reserved for failures that cannot be identified from structured code, causal stage, status, and available error evidence.

2. **Stable Failure Groups**
   Every actionable diagnostic group receives a stable identity, its root cause, and the exact affected page set. Recovery actions and cooldown state operate on that captured group rather than whichever failures are globally current at click time.

3. **Action Contract**
   An actionable resolution must perform the operation stated by its label. Where automatic recovery is unavailable, the interface presents truthful manual guidance rather than implying the operation occurred.

   - `MISSING_KEY`: open Settings at the Gemini API key field, focus/select the field, validate the saved key, then make the original group eligible for manual retry when valid.
   - `QUOTA_EXHAUSTED`: use group-scoped cooldown, show remaining time, enable manual retry at expiry, and never retry automatically merely because time elapsed.
   - `SAFETY_BLOCKED`: enable the existing Comic Slicing/NSFW bypass state used by the next translation request and retry only the associated group when the user accepts that action.
   - `LOCAL_SIDECAR_OFFLINE`: invoke the desktop cleaner recovery operation when available. Recovery checks health, performs at most one managed restart when needed, verifies health, and reports success/failure. Successful service recovery does not automatically retry pages.
   - `LOCAL_CLEANER_FAILED`: present cleaner/model failure information and an appropriate retry or remediation path without claiming the service is offline.
   - `NETWORK_OR_TIMEOUT`: retry only the pages captured by the associated group when the user requests retry.

4. **Quota Cooldown**
   Cooldown belongs to the quota failure group rather than one global workspace timer. Provider `Retry-After` guidance is normalized to a bounded absolute expiry when valid; otherwise the documented bounded fallback is used. Repeated quota responses may extend but never shorten the existing group expiry. Expiry enables retry and does not itself send a request.

5. **Desktop Environment Auto-Forwarding**
   The desktop workspace process continues to receive the configured translation environment when launched so valid existing API-key configuration remains available in desktop mode.

## Consequences

- **Positive**: Diagnostic text now describes the boundary that actually failed, preventing a healthy service with a model error from being misreported as offline.
- **Positive**: Stable failure groups preserve the relationship between cause, page set, cooldown, and recovery action across UI changes and later failures.
- **Positive**: Cleaner and credential repair remain user-controlled and cannot unexpectedly start AI or translation work after a dependency becomes healthy.
- **Positive**: Group-scoped quota cooldown prevents independent page retry storms without blocking unrelated diagnostic actions.
- **Trade-off**: The workspace must retain failure-group identity and recovery state until resolution rather than deriving every modal row from a transient failures array.
- **Trade-off**: Desktop cleaner recovery requires a renderer-to-main recovery bridge and observable recovery states.

## Amendment Note

This amendment extends the original diagnostic ADR with `LOCAL_CLEANER_FAILED`, stable failure groups, group-scoped quota cooldown, credential verification, and explicit cleaner-recovery semantics. The original structured-error and environment-forwarding intent remains accepted.
