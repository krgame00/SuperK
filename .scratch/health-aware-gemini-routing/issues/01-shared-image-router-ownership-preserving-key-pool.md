# 01: Shared Image Router + Ownership-Preserving Key Pool

**What to build:** Move Gemini image translation onto the shared catalog/router so image requests no longer depend on an independent fixed model hierarchy. Build one Effective Gemini route pool that prefers user-owned routes, then server-owned fallback routes, while retaining non-secret ownership metadata and de-duplicating duplicate credentials. Catalog, validation, and translation routing must observe the same configurable key limit.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Image translation uses the shared Gemini routing authority rather than the legacy fixed model list.
- [ ] User-provided routes are attempted before server-provided fallback routes while ownership remains distinguishable in safe route metadata.
- [ ] Duplicate credentials across user/server inputs are not executed twice in one request.
- [ ] Manual model selection remains pinned to the selected model while allowing eligible key rotation for that model.
- [ ] `SUPERK_GEMINI_MAX_KEYS` controls the credential bound and defaults to 10.
- [ ] Catalog discovery, key validation, and image routing observe the same configured key bound.
- [ ] Existing payload-size, MIME, safety, prompt/response parsing, and cancellation behavior remains unchanged.
- [ ] Regression tests prove that raw API key values are absent from route metadata and client-visible responses.
