# Health-Aware Gemini Routing Implementation Plan

> **For agentic workers:** Execute these tasks in order using test-driven development. Check each box only after the command output confirms it.

**Goal:** Complete the seven ready-for-agent tickets in `.scratch/health-aware-gemini-routing/issues/`.

**Architecture:** The shared catalog owns route discovery, model compatibility, and cross-request health. The route runner owns bounded provider attempts. The API, browser workflow, Settings, and extension consume those server contracts.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Vitest, React Testing Library, Chrome Extension JavaScript.

## Global Constraints

- Preserve MIME, size, safety, cancellation, and response parsing behavior.
- Keep raw Gemini keys out of responses, logs, and persisted state.
- Use `SUPERK_GEMINI_MAX_KEYS`, default 10.
- Bound route attempts to 25 seconds and total image routing to 60 seconds.
- Keep model overload in memory for 30 seconds; persist quota cooldown and workflow-specific last-known-good.
- Keep Manual pinned to its selected model.
- Preserve all unrelated uncommitted workspace changes.

---

### Task 1: Effective pool and route ordering

**Files:** `lib/server/geminiCatalog.ts`, `tests/translation/healthAwareGeminiRouting.test.ts`.

**Interface:** `resolveActiveGeminiKeyPool(userApiKeyRaw, serverApiKeyRaw)` and `GeminiCatalogManager.planRoutes(catalog, options)`.

- [ ] Write a test with different user/server model availability that asserts every eligible user route precedes server fallback routes in Auto, and Manual stays on its model.
- [ ] Run `./node_modules/.bin/vitest.cmd run tests/translation/healthAwareGeminiRouting.test.ts`; confirm the new assertion fails.
- [ ] Make the smallest ordering change in `planRoutes` without losing model health, compatibility, and last-known-good filtering.
- [ ] Run the same test and `./node_modules/.bin/tsc.cmd --noEmit`; confirm both pass.

### Task 2: Hard request deadline and recovery ownership

**Files:** `lib/server/geminiRequest.ts`, `lib/server/geminiTranslationRouter.ts`, `lib/server/geminiCatalog.ts`, `tests/translation/geminiRequest.test.ts`, `tests/translation/healthAwareGeminiRouting.test.ts`.

**Interfaces:** `requestGeminiRoutes(options)` and `GeminiCatalogManager.claimRecoveryTrial(poolId, model)`.

- [ ] Add fake-timer tests where fetch or response body ignores abort and where a half-open trial fails transiently.
- [ ] Run each focused test and confirm it fails for the missing deadline or recovery behavior.
- [ ] Enforce the earlier of route and total deadline around provider work, release half-open ownership on transient failure, and renew model cooldown only after clear high demand.
- [ ] Re-run focused tests and TypeScript check.

### Task 3: Error and health contracts

**Files:** `lib/server/geminiTranslationRouter.ts`, `src/app/api/translate/route.ts`, `src/app/api/translate/models/route.ts`, `tests/translation/routes.test.ts`, `tests/translation/modelCatalogRoute.test.ts`.

**Interfaces:** safe `retryAfterMs` / `nextRetryAt`, model health status, and translation `meta`.

- [ ] Add API-boundary assertions for actionable cooldown timing, model overload, key non-disclosure, and catalog health separate from key validity.
- [ ] Run the focused tests and confirm any new assertion fails for a real missing behavior.
- [ ] Implement only the missing API mapping and health fields.
- [ ] Re-run focused tests and TypeScript check.

### Task 4: Browser and Settings recovery

**Files:** `hooks/useTranslation.ts`, `components/workspace/SettingsModal.tsx`, `tests/translation/useTranslation.test.tsx`, `tests/workspace/SettingsModalGeminiCatalog.test.tsx`.

**Interfaces:** `modelPreference`, safe translation status, Settings catalog payload.

- [ ] Add interaction tests for at most one transport retry, zero server-router retry, explicit Manual-to-Auto action, and safe health wording.
- [ ] Run the focused files and confirm missing behaviors fail.
- [ ] Implement the smallest UI and retry changes.
- [ ] Re-run focused tests and TypeScript check.

### Task 5: Extension parity

**Files:** `chrome-extension/background.js`, `chrome-extension/server.js`, `tests/chrome-extension/runtime.test.ts`.

- [ ] Test that available SuperK routing is authoritative and server cooldown/overload responses do not fall through to direct Gemini routing.
- [ ] Run the extension test and confirm any new case fails.
- [ ] Make the smallest extension integration change.
- [ ] Re-run extension tests and TypeScript check.

### Task 6: Verification, notes, and review

**Files:** `docs/AI-WORKING-NOTES.md`, this plan, and implementation files.

- [ ] Update acceptance checkboxes and working notes with exact verification evidence and any remaining regression risk.
- [ ] Run `./node_modules/.bin/tsc.cmd --noEmit`, targeted routing/UI/extension tests, then `./node_modules/.bin/vitest.cmd run --root .` once.
- [ ] Review the final diff against the spec and project rules; fix concrete findings.
- [ ] Stage only relevant files and commit the completed work on the current branch.

## Execution status — 2026-09-23

- **VERIFIED WORKING in deterministic tests:** Effective pool ordering, non-contiguous model skip, route and discovery deadlines even when abort is ignored, retry timing across model and key cooldowns, recovery claim release at an exhausted budget, HTTP success validation before Last-known-good, generic `502` retry, and raw-key redaction. Each new behavior was first observed failing in a focused test, then passing after its implementation.
- **VERIFIED WORKING in cross-surface tests:** Extension uses shared routing while the server is reachable, does not begin offline routing after server timeout, and retains offline dynamic discovery for genuine connection failure. Manual failure exposes an explicit Auto switch in the workspace. Auto progress now states the fallback policy while a request is pending; exact route-switch events are not streamed to the browser.
- **Verification evidence:** `tsc --noEmit` passed; focused cross-surface suite 82/82 passed before the final timeout-classification correction; final full Vitest suite **140 files / 874 tests passed**; focused ESLint on routing modules, image API, and routing tests passed; `git diff --check` passed. Broad ESLint still reports existing React hook and legacy-test `any` violations outside the new routing logic.
- **EXPERIMENTAL / operational validation pending:** The real manga image workload has not been rerun against Gemini from this environment. Keep the fixed path available for immediate rollback until that validation is complete.
