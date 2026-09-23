# 0017. Health-Aware Gemini Routing with Ownership-Preserving Fallback

Date: 2026-09-22

## Status

Accepted

## Context

ADR-0014 established dynamic Gemini discovery, workflow compatibility, route cooldowns, and last-known-good routing, but the production image-translation path still used a fixed model hierarchy and treated a user key as replacing the server pool. Under current Gemini conditions this can spend minutes retrying overloaded models or exhausted routes even though healthier alternatives exist.

## Decision

SuperK will route image translation through the shared catalog/route manager rather than maintain a separate fixed fallback hierarchy. User-provided and server-provided Gemini credentials remain separate ownership-scoped key pools, but one request may build an **Effective Gemini route pool** that prefers user-owned routes and then uses server-owned routes as fallback while preserving ownership metadata.

Quota failures (`429`) cool down only the failing model+key route, honoring `Retry-After` when present and otherwise using a 60-second fallback cooldown. A clear upstream `503 High demand` is treated as temporary model-wide overload: SuperK skips the remaining keys for that model, places the model in a short 30-second overload cooldown, and continues with another eligible model instead of burning the entire key pool against the same overloaded model. Generic `500/502` failures may retry the same route once before fallback.

Auto routing prefers an eligible workflow-specific Last-known-good translation model, then other healthy compatible stable models. Manual model selection may rotate keys for that model but never silently switch models. The direct translation request budget is 25 seconds per route attempt and 60 seconds total. Browser-level translation retry is limited to one additional automatic retry for transport/network failure only; quota, router timeout, and upstream overload complete with an actionable failure state instead of re-running the whole routing tree three times.

Gemini key discovery and health management use a configurable key cap via `SUPERK_GEMINI_MAX_KEYS`, defaulting to 10, so catalog health and translation routing observe the same configured credentials up to that bound.

Quota route cooldowns and Last-known-good state persist safely across server restarts using non-secret credential identity; model-wide `503` overload cooldown remains in memory only. Last-known-good priority is fresh for 24 hours after the latest successful translation, after which the model returns to normal ranking until it proves itself again.

Within the healthy eligible set, Auto ranks routes by workflow compatibility and health first, then recent successful latency using a rolling/EWMA-style signal rather than a permanent hard-coded speed order. When a model-wide overload cooldown expires, the model enters a half-open recovery state: only one real translation request may probe it. Success reopens normal traffic; another clear high-demand response renews the 30-second overload cooldown. SuperK does not run periodic background translation probes.

Settings distinguishes credential validity from route/model health. It may report credential counts such as `8/8 valid`, while model status uses explicit states such as ready, partially quota-limited, high demand, cooldown, or incompatible. Refreshing the catalog does not spend translation quota to probe every model and key; an explicit per-model test action may do so when requested by the user.

Manual model selection respects the selected model contract. If every route for that model is cooling down or unavailable, the request fails fast with the reason and retry time where known, and the UI may offer a deliberate switch to Auto; it never silently substitutes another model.

If all eligible Auto routes are known to be cooling down or unavailable, the router also fails fast instead of waiting inside the request. It returns the earliest known retry opportunity (`retryAfterMs` / `nextRetryAt`) so the UI can explain when another attempt becomes meaningful. Gemini route health is shared at the server/router level across page requests; a model in half-open recovery permits only one real recovery trial at a time.

Translation observability records non-secret route evidence sufficient to explain latency and failures: model, credential ownership (`user` or `server`), non-secret key slot/fingerprint, attempt count, fallback count, elapsed time, final error, cooldown reason, and skipped-route count. Raw API keys must never be emitted to logs, diagnostics, catalog responses, or UI state.

During Auto fallback, the normal workspace UI shows concise progress such as `Auto · switching to an available model…` rather than individual route attempts. On completion it may show the selected model, elapsed time, and fallback count; detailed route evidence belongs in diagnostics. Settings shows aggregate credential/model health by default and exposes per-model/key-slot detail only in an advanced view without revealing secrets.

The routing change is considered successful when known cooldowns fail fast, a clear `503 High demand` skips the remainder of that model's key routes after the first overload response, direct server translation never exceeds the 60-second hard request budget, the browser does not rerun the full routing tree three times, a fresh healthy Last-known-good model is attempted first, and deterministic tests cover quota, overload, cooldown, half-open recovery, fallback ordering, and manual-model behavior.

The shared server routing layer is the source of truth for Web and Extension translation behavior. Existing extension-specific fallback logic should be reduced or connected to the same routing semantics where it bypasses the shared API, without rewriting unrelated extension behavior.

## Consequences

- **Positive**: Temporary overload on one model no longer multiplies across every credential before fallback.
- **Positive**: Route quota, model overload, compatibility, and credential ownership remain distinct states.
- **Positive**: The production image route finally consumes the same health-aware routing semantics already modeled by the catalog manager.
- **Positive**: Translation latency is bounded more tightly and browser retry no longer multiplies an already-complete server fallback pass.
- **Trade-off**: A temporarily slow model may be skipped earlier even if waiting longer would eventually succeed.
- **Trade-off**: Route-health state becomes operationally important and must be observable, persisted safely, and covered by deterministic tests.
