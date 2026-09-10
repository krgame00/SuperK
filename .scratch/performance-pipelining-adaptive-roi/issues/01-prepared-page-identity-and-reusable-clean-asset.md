# 01: Prepared-page Identity & Reusable Clean Asset

**What to build:** Make completed local page preparation a durable, reusable clean asset keyed by Prepared-page identity, so expensive cleaning can be reused after cancellation and application restart without ever serving stale output. The identity must change when the source image, authorized text-removal mask, or cleaning policy/model revision changes, while translation-only settings such as glossary or target language must not invalidate the clean result. Reuse the existing clean-page asset/cache rather than creating a second durable image cache.

**Blocked by:** None (can start immediately).

**Status:** implemented (frontend verified; Python integration environment pending)

**Evidence (2026-09-10):** `useCleaning` now records source/mask/pipeline identity, rejects legacy or mismatched persisted metadata, verifies current source bytes on restore, and replaces stale in-memory results. Revision-ordered IndexedDB writes prevent late jobs from overwriting newer metadata. Focused cleaning tests cover reuse, source changes, old pipeline invalidation, restore races, stale jobs, and metadata ordering.

- [ ] A successfully prepared page can be reused on a later attempt and after application restart when its Prepared-page identity still matches.
- [ ] Prepared-page identity distinguishes source image revision, text-removal mask revision, and cleaning policy/model revision.
- [ ] Changing the source image or authorized mask invalidates the previously prepared result before it can be consumed.
- [ ] Changing the cleaning policy/model revision invalidates the previously prepared result before it can be consumed.
- [ ] Changing glossary, target language, or another translation-only setting does not invalidate an otherwise valid clean asset.
- [ ] If a prepared result finishes after a newer source/mask/policy revision exists, the stale result cannot replace or override the newer identity.
- [ ] Normal cache eviction is handled as a cache miss and recomputation, not as a user-visible failure.
- [ ] The implementation stores successful prepared output through the existing clean-page asset/cache mechanism and does not introduce a second large durable image cache.
- [ ] Tests cover valid reuse, restart reuse, source invalidation, mask invalidation, policy/model invalidation, translation-only non-invalidation, stale late completion, and ordinary cache-miss behavior.
