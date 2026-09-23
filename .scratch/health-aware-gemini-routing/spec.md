# Health-Aware Gemini Routing and Fast Fallback

**Triage:** `ready-for-agent`
**Status:** ready-for-agent
**Date:** 2026-09-22

## Problem Statement

SuperK can currently spend one to three minutes translating a manga page when Gemini is overloaded or quota-limited. The direct image-translation path still uses a fixed model hierarchy, retries some server failures on the same model, and can rotate through many credentials before discovering that the problem applies to the whole model. Browser-level page retry can then repeat much of that work again.

The current behavior also blurs several distinct states. A valid Gemini credential is not the same thing as a model with remaining quota; a model that is temporarily overloaded is not incompatible; and a user-provided credential should not lose its ownership identity merely because server credentials are available as fallback. Settings currently cannot communicate those differences precisely, and the production image path does not yet consume the shared catalog/router semantics already modeled elsewhere in SuperK.

The user needs Auto translation to choose healthy routes quickly, remember recent successful routes, avoid retry storms, use all configured credentials consistently, fail fast when no meaningful route is available, and explain what happened without exposing API keys.

## Solution

Make the shared Gemini catalog/router the source of truth for image translation, model health, and model selection. One translation request builds an **Effective Gemini route pool** from ownership-scoped **Gemini key pools**: user-owned routes are preferred, then server-owned routes may act as fallback while ownership metadata remains explicit.

Treat provider failures according to their actual scope. A `429` cools down only the failing model+key route, using `Retry-After` where available. A clear `503 High demand` is a temporary model-wide overload: skip the remaining keys for that model immediately, place the model in a short in-memory cooldown, and continue with another healthy eligible model. Generic `500/502` failures may retry the same route once before fallback.

Auto routing prefers a fresh, healthy **Last-known-good translation model**, then other healthy image-compatible stable models using recent successful latency as a ranking signal. Last-known-good priority remains fresh for 24 hours. After a model-wide overload cooldown expires, allow only one **Gemini model recovery trial** before reopening the model to normal traffic.

Bound the direct translation path to 25 seconds per route attempt and 60 seconds total. Browser retry may perform at most one additional automatic retry for genuine network/transport failure and must not re-run the complete server routing tree three times for quota, overload, or router timeout.

Settings distinguishes **Gemini credential validity** from **Gemini route health**. It reports aggregate credential validity separately from model states such as ready, partially quota-limited, high demand, cooldown, or incompatible, with optional advanced non-secret route detail. Catalog refresh does not spend translation quota probing every model/key combination.

Persist quota-route cooldown and Last-known-good state across restart using non-secret credential identity. Keep model-wide `503` overload cooldown and half-open recovery state in server memory only. Support a configurable Gemini key limit using `SUPERK_GEMINI_MAX_KEYS`, default 10, so catalog and routing observe the same credential set.

## User Stories

1. As a manga translator, I want Auto translation to avoid spending minutes on known-bad routes, so that pages finish or fail quickly.
2. As a manga translator, I want a `503 High demand` response to move away from the overloaded model immediately, so that SuperK does not try the same overloaded model with every key.
3. As a manga translator, I want quota exhaustion on one model+key route to leave unrelated routes usable, so that one exhausted route does not disable an entire credential.
4. As a manga translator, I want `Retry-After` honored when Gemini provides it, so that retries happen only when they are meaningful.
5. As a manga translator, I want a sensible fallback cooldown when no `Retry-After` is provided, so that SuperK does not hammer an exhausted route.
6. As a manga translator, I want temporary overload to remain temporary health state rather than incompatibility, so that a working model can recover automatically later.
7. As a manga translator, I want Auto to remember the model that recently succeeded for image translation, so that repeated work starts with proven routes.
8. As a manga translator, I want Last-known-good preference to expire after 24 hours, so that an old success does not permanently pin Auto.
9. As a manga translator, I want healthy recent latency to influence Auto ordering, so that faster proven models are preferred over consistently slow ones.
10. As a manga translator, I want latency ranking to use successful requests rather than hard-coded assumptions, so that Auto adapts as Gemini service conditions change.
11. As a manga translator, I want preview/experimental models excluded from normal Auto behavior unless I opt in, so that Auto remains stability-oriented.
12. As a manga translator, I want workflow compatibility evaluated before speed, so that a fast model that cannot satisfy image translation is never preferred.
13. As a manga translator, I want user-provided credentials attempted before server fallback credentials, so that my own configured routes remain the primary ownership domain.
14. As a manga translator, I want server credentials available as fallback when my routes are exhausted or unhealthy, so that a saved browser key cannot block usable local keys.
15. As a manga translator, I want credential ownership preserved in diagnostics, so that I can tell whether a user or server route served the request without exposing the key.
16. As a manga translator, I want duplicate user/server credentials de-duplicated safely, so that the same key is not wasted twice in one Effective Gemini route pool.
17. As a manga translator, I want all configured keys up to the configured limit considered consistently by both catalog and translation routing, so that Settings does not see five while translation sees eight.
18. As a manga translator, I want the default configured key limit to support ten keys, so that my current eight-key setup works without source-code edits.
19. As a manga translator, I want the key limit configurable through environment configuration, so that future deployments can choose a different bound without code changes.
20. As a manga translator, I want manual model selection to keep the exact selected model, so that SuperK never silently substitutes another model.
21. As a manga translator, I want Manual mode to rotate among healthy keys that expose my selected model, so that I still benefit from multi-key routing.
22. As a manga translator, I want Manual mode to fail fast when all routes for my chosen model are unavailable, so that I do not wait a minute for a result that cannot succeed.
23. As a manga translator, I want a Manual failure to tell me why the model is unavailable, so that I can distinguish quota from overload or incompatibility.
24. As a manga translator, I want Manual failure to show the next known retry time when available, so that I know when retrying becomes useful.
25. As a manga translator, I want Manual failure to offer an explicit switch to Auto, so that model substitution happens only with my consent.
26. As a manga translator, I want a known all-routes cooldown state to fail fast, so that the server does not consume the 60-second request budget waiting for a known timer.
27. As a manga translator, I want the earliest known retry opportunity returned when all routes are cooling down, so that the UI can provide actionable timing.
28. As a manga translator, I want a hard server translation budget of at most 60 seconds, so that one page cannot remain stuck in routing for several minutes.
29. As a manga translator, I want each route attempt bounded to 25 seconds, so that one unresponsive route cannot consume the entire request budget.
30. As a manga translator, I want browser retry limited to one extra attempt only for genuine network/transport failure, so that server fallback is not multiplied by three client attempts.
31. As a manga translator, I want quota, high-demand, and router-timeout failures to stop client-level automatic re-routing, so that retry storms are avoided.
32. As a batch translator, I want route health shared across pages, so that page 2 does not repeat a failure page 1 just learned.
33. As a batch translator, I want only one request to test an overloaded model after cooldown, so that many pages do not simultaneously probe the same failing service.
34. As a batch translator, I want a successful recovery trial to reopen normal traffic, so that recovered models return automatically.
35. As a batch translator, I want a failed recovery trial to restore the overload cooldown, so that the model is not immediately hammered again.
36. As a manga translator, I want Settings to report credential validity separately from model health, so that “valid key” is not mistaken for “quota available.”
37. As a manga translator, I want aggregate Settings health such as credentials valid, ready, high demand, and quota cooldown, so that I can diagnose the system at a glance.
38. As an advanced user, I want per-model/key-slot health detail without raw API keys, so that I can investigate routing without exposing credentials.
39. As a manga translator, I want catalog refresh to update discovery and expired state without sending a translation probe to every model/key pair, so that opening or refreshing Settings does not waste quota.
40. As a manga translator, I want an explicit per-model test action when I deliberately want to spend quota verifying a model, so that probing is intentional.
41. As a manga translator, I want Auto progress to say it is switching to another available model, so that fallback does not look like the app is frozen.
42. As a manga translator, I want successful translation status to show the selected model, elapsed time, and fallback count, so that I can understand performance without opening diagnostics.
43. As a manga translator, I want route-level details kept out of the normal workspace UI, so that normal translation remains uncluttered.
44. As a maintainer, I want translation diagnostics to include model, credential ownership, non-secret key identity, attempts, fallbacks, elapsed time, final error, cooldown reason, and skipped-route count, so that slow requests can be explained from evidence.
45. As a maintainer, I want raw API keys excluded from logs, diagnostics, catalog responses, persisted health state, and UI state, so that observability does not weaken credential security.
46. As a maintainer, I want quota route cooldown persisted across restart, so that restarting the server does not immediately retry a known exhausted route.
47. As a maintainer, I want model-wide overload cooldown kept in memory only, so that a 30-second provider condition does not become stale persisted state.
48. As a maintainer, I want Last-known-good state persisted safely across restart, so that recent proven routing survives normal server restarts.
49. As a maintainer, I want Last-known-good state tracked separately by workflow, so that text success does not incorrectly control image routing.
50. As a maintainer, I want compatibility state kept separate from health state, so that quota, overload, timeout, and network problems never poison capability knowledge.
51. As a maintainer, I want the shared catalog/router to replace the production image route's fixed model hierarchy, so that there is one routing policy.
52. As a maintainer, I want Web and Chrome Extension translation behavior to derive from the same shared server semantics, so that fallback rules do not drift.
53. As a maintainer, I want extension-specific fallback logic removed or subordinated where it bypasses shared routing, so that the extension cannot contradict server health decisions.
54. As a maintainer, I want existing unrelated extension behavior left intact, so that routing work does not become a broad extension rewrite.
55. As a maintainer, I want deterministic tests for quota cooldown, overload skip, half-open recovery, fallback ordering, Manual behavior, and request budgets, so that routing changes remain safe.
56. As a maintainer, I want route tests to use fake clocks and fake provider responses, so that health timing can be verified without real quota or network dependencies.
57. As a maintainer, I want application-boundary tests to prove the image translation API uses the shared router, so that the legacy fixed hierarchy cannot silently return.
58. As a maintainer, I want Settings tests to verify credential-validity and model-health wording independently, so that UI labels remain truthful.
59. As a maintainer, I want browser workflow tests to prove a server routing failure is not retried three full times, so that client behavior cannot reintroduce minute-scale latency.
60. As a maintainer, I want existing safety, payload validation, MIME validation, and translation response parsing preserved, so that routing optimization does not weaken unrelated contracts.

## Implementation Decisions

### Shared routing authority

- The shared Gemini catalog and translation router become the canonical routing authority for image translation.
- Remove the production image path's independent fixed model hierarchy after equivalent shared-router behavior is covered by tests.
- Web and Chrome Extension translation behavior must consume the shared server routing semantics. Extension-specific code may retain transport/integration responsibilities but must not maintain a contradictory canonical fallback hierarchy.
- Existing OpenAI-compatible translation behavior is preserved as an independent provider path; this spec changes Gemini routing and fallback semantics rather than redesigning non-Gemini providers.

### Ownership-preserving credential composition

- A **Gemini key pool** remains ownership-scoped: user-provided and server-provided credentials are distinct domains.
- A request may construct an **Effective Gemini route pool** from more than one ownership-scoped pool while preserving route ownership metadata.
- User-owned routes are ordered before server-owned fallback routes when both are available.
- Duplicate credentials across ownership inputs are de-duplicated for execution without exposing or persisting raw values.
- Credential identity in routing state uses non-secret slot/fingerprint metadata.
- Catalog discovery, validation, health, and translation routing use the same configurable credential bound.
- The bound is controlled by `SUPERK_GEMINI_MAX_KEYS` and defaults to 10.

### Route and model health

- Keep **Translation model compatibility** independent from **Gemini route health**.
- `429` represents quota/rate-limit health on the specific model+key route. Record a route cooldown using provider `Retry-After` when present, otherwise use a 60-second fallback.
- Persist quota-route cooldown using non-secret credential identity. Expired cooldowns are removed automatically.
- A clear Gemini `503 High demand` represents model-wide overload for routing purposes. Skip remaining key routes for that model after the first clear overload response.
- Model-wide overload cooldown is 30 seconds and remains server-memory-only.
- Generic `500/502` responses may retry the same route once before ordinary fallback; they do not automatically create model-wide overload state.
- Timeout and transport failures remain transient health evidence and do not mark a model incompatible.
- Capability/contract errors may still update workflow-specific compatibility under the existing catalog rules.

### Half-open model recovery

- After a model-wide overload cooldown expires, the model enters a half-open recovery state.
- Permit only one **Gemini model recovery trial** at a time across server requests.
- The recovery trial is a normal real translation request; do not create periodic background translation probes.
- A successful trial reopens the model to normal routing and records normal success health/latency.
- Another clear high-demand response returns the model to a new 30-second overload cooldown.
- Concurrent requests encountering a model already in half-open trial skip that model and continue with other eligible routes rather than waiting on the trial.

### Auto ranking

- Auto first filters by workflow compatibility, route/model health, release-channel policy, and credential eligibility.
- A fresh, healthy **Last-known-good translation model** receives highest normal Auto preference for that workflow.
- Last-known-good freshness lasts 24 hours from the latest successful request for that workflow/model.
- Persist Last-known-good model identity and success timestamp across restart using non-secret state.
- After Last-known-good expires, the model returns to normal ranking rather than becoming disabled.
- Among healthy compatible stable candidates, use recent successful latency as a ranking signal. Use a bounded rolling/EWMA-style signal so one outlier does not permanently reorder models.
- Latency ranking is secondary to compatibility and health and must not promote an incompatible, cooling-down, overloaded, or disallowed preview model.
- Preview/experimental models remain excluded from Auto unless existing user policy explicitly permits them.

### Manual routing

- Manual selection pins one model while allowing rotation among eligible credentials for that same model.
- Manual never substitutes another model silently.
- If every route for the selected model is known unavailable/cooling down, fail before spending the normal 60-second routing budget.
- Return an actionable reason and the earliest known retry time where available.
- The UI may offer an explicit action to switch to Auto; accepting that action changes the routing contract for the next request.

### Request budgets and client retry

- Gemini image translation uses a 25-second per-route attempt timeout and a hard 60-second total request budget, including routing execution. Discovery must remain bounded inside the request budget.
- A known “no eligible route until later” condition fails immediately instead of waiting inside the request.
- Browser-level automatic retry is reduced to at most one additional retry for genuine network/transport failure.
- Quota, clear model overload, shared-router timeout, incompatible model, Manual route exhaustion, and known cooldown are not reasons to re-run the complete routing tree at browser level.
- Preserve user-initiated retry actions after failures; the change targets automatic retry multiplication.

### Health persistence and scope

- Quota route cooldown and Last-known-good state persist across server restarts.
- Model-wide overload cooldown, half-open ownership, and other very short-lived transient states remain in memory only.
- **Gemini route health** is shared by the server/router across page requests, not scoped to one manga page or one HTTP request.
- Persisted state must remain bounded, expiring obsolete cooldown and stale performance observations.
- Raw API keys are never persisted into catalog or health state.

### Observability and error contracts

- Extend existing translation observability rather than creating a separate diagnostics subsystem.
- Safe diagnostics may include provider, selected model, credential ownership, non-secret key slot/fingerprint, attempt count, fallback count, elapsed time, skipped-route count, final error code, and cooldown reason.
- Never emit raw API keys in logs, URLs, API responses, persisted routing state, or client diagnostics.
- When all eligible routes are cooling down, return the earliest known retry opportunity through structured retry timing such as `retryAfterMs` and/or `nextRetryAt`.
- Preserve the existing structured translation-error boundary and extend error codes/categories only where needed to distinguish overload, route exhaustion, and actionable retry timing.
- Final errors should describe the most actionable current routing state rather than merely returning the first provider error encountered after fallback.

### Settings and health presentation

- Distinguish **Gemini credential validity** from model/route health.
- Credential validity means the credential is accepted and exposes usable Gemini API models; it does not claim remaining quota on every model.
- Settings may show aggregate credential validity such as “8/8 valid” while separately reporting model states.
- Model health vocabulary includes ready, partially quota-limited, high demand, cooldown, incompatible, and unverified where applicable.
- Default Settings presentation is aggregate and compact.
- An advanced health view may expose model/key-slot detail using only non-secret identity.
- Catalog refresh performs discovery and expires stale health state; it does not automatically issue `generateContent` translation probes against every model/key pair.
- A deliberate per-model test action may spend quota to verify a selected model when the user explicitly invokes it.
- Saved Manual models that are unavailable remain visible with truthful state rather than being silently rewritten.

### User-visible translation progress

- During Auto fallback, show concise progress indicating that Auto is switching to an available model instead of exposing every internal route attempt.
- After success, the workspace may show the chosen model, elapsed time, and fallback count.
- Detailed key-slot, cooldown, and skipped-route evidence stays in diagnostics/advanced surfaces.
- Manual failures explain the selected model's current reason and retry timing and may offer “switch to Auto.”

### Compatibility with existing behavior

- Preserve request size checks, MIME checks, safety handling, prompt/response parsing, cleaning workflow, prepared-page behavior, and translation overlay behavior.
- Preserve explicit user cancellation semantics.
- Preserve catalog stale-cache/emergency-bootstrap recovery semantics except where ownership-preserving composition and health ranking update route planning.
- Do not infer permanent incompatibility from quota, overload, timeout, or network conditions.

## Testing Decisions

The user confirmed the testing seams before this specification was published as `ready-for-agent`.

- Prefer external behavior over private data structures or exact helper implementation. Assert route order, provider calls, elapsed-budget behavior, returned retry metadata, UI state, and secret non-disclosure.
- Use the shared router/catalog boundary as the primary seam. Existing Gemini request and catalog tests already inject provider fetches, clocks, sleeps, and route lists; extend that seam for deterministic health state.
- At the shared-router seam, cover: route-specific `429` cooldown; `Retry-After`; default quota cooldown; clear `503 High demand` skipping remaining keys for that model; 30-second model overload cooldown; half-open single-flight recovery; generic `500/502` same-route retry once; timeout/transport classification; compatibility preservation; Last-known-good 24-hour freshness; persisted Last-known-good and quota cooldown; latency ranking; preview policy; user-before-server ownership ordering; de-duplication; configurable maximum keys; all-routes-known-unavailable fail-fast; and absence of raw credentials from outputs/state.
- Use the image translation API and model-catalog API as the application boundary seam. Prior route tests already verify timeout mapping, key handling, validation, MIME limits, and response status. Replace the legacy fixed-routing expectation with shared-router behavior and assert the 25-second attempt / 60-second hard budget contract at the API boundary.
- API-boundary tests should verify that user and server ownership can both contribute routes, aggregate credential validity is distinct from model health, retry timing is propagated safely, successful observability is safe, and Manual mode never changes models.
- Use existing Settings model-catalog component tests for UI health semantics. Verify aggregate credential validity, ready/high-demand/quota-cooldown states, advanced non-secret detail, unavailable saved Manual model behavior, catalog refresh without implicit translation probes, and explicit model-test behavior if that control is added.
- Use the existing browser translation workflow seam for automatic retry behavior. Verify network/transport may receive at most one additional automatic retry, while quota, overload, router timeout, Manual route exhaustion, incompatibility, and known cooldown do not cause three full translation attempts.
- Verify concise fallback progress and final model/elapsed/fallback summary at the highest existing workspace interaction seam rather than testing private state setters.
- For Chrome Extension parity, use the existing extension integration seam only. Assert that extension requests/settings do not retain an independent canonical model fallback hierarchy when shared server routing is available. Do not duplicate the router's behavior matrix inside extension unit tests.
- Use fake time for 30-second overload cooldown, half-open recovery, quota expiry, and 24-hour Last-known-good freshness. Do not use real sleeps.
- Use deterministic fake provider responses for quota/high-demand tests. Real Gemini probes are operational diagnostics, not the regression suite.
- Security regression: serialized catalog state, observability metadata, server logs captured by tests where practical, and client-visible responses must not contain the synthetic raw API keys used in fixtures.
- Performance acceptance: a known cooldown condition fails without provider work; a clear model-wide high-demand response does not attempt other keys for that model; no direct Gemini image translation starts a new attempt after the 60-second total budget; and browser retry cannot multiply a completed server fallback tree by three.
- Preserve prior tests for request validation, safety, cancellation, response parsing, stale catalog fallback, capability learning, and route-level quota behavior unless the accepted routing decision intentionally changes their expected result.

## Out of Scope

- Purchasing or provisioning additional Gemini quota.
- Guaranteeing that a particular Gemini model is always fast or available.
- Predicting provider-wide capacity beyond evidence from current requests.
- Treating distinct API keys as guaranteed independent quota projects.
- Permanently blacklisting a model because of transient overload, timeout, quota, or network failures.
- Replacing Gemini's provider API, retraining models, or changing translation prompt quality as part of this routing work.
- Redesigning the OpenAI-compatible provider path or making it share Gemini-specific health state.
- Rewriting the Chrome Extension outside routing/settings parity.
- Reworking the cleaning/inpainting pipeline, text detection, overlay rendering, export, or unrelated workspace UI.
- Running background quota-consuming model probes on timers.
- Exposing raw credentials for debugging.
- Creating implementation tickets or changing production routing code as part of this to-spec step.

## Further Notes

This specification is the implementation-ready successor to the earlier dynamic Gemini catalog/routing design. ADR-0017, **Health-Aware Gemini Routing with Ownership-Preserving Fallback**, supersedes the earlier routing ownership/fallback decision where they conflict.

The accepted domain vocabulary includes **Gemini key pool**, **Effective Gemini route pool**, **Gemini route health**, **Gemini model overload cooldown**, **Gemini model recovery trial**, **Gemini credential validity**, **Gemini model route**, **Translation model compatibility**, and **Last-known-good translation model**.

The triggering production evidence showed eight configured local Gemini credentials, all reaching Gemini while the first Auto model returned `503 High demand`; a later pool request to another model returned `429`; real page translations were observed taking roughly 85 seconds to almost three minutes with one three-minute timeout. Those measurements motivated the health-aware routing policy but are not permanent assumptions about Gemini service health.

The project issue tracker is local Markdown. This specification is published there as `ready-for-agent`. The next workflow step is ticket decomposition, not additional product interviewing.
