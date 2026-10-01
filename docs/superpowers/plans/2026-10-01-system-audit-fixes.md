# System Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Resolve the ten findings in `docs/2026-10-01-system-audit.md` with regression coverage and fresh full gates.

**Architecture:** Keep current fixed/dynamic routing and UI policies. Reuse deadline handling and local process ownership concepts; restore review state through existing IndexedDB metadata. No model changes or dependencies.

**Tech Stack:** Next.js 16.3.6, React 19, TypeScript, Vitest, Python/FastAPI, PowerShell/VBScript.

## Global Constraints

- Branch: `codex/system-audit-fixes`; baseline `710c7fe`.
- Read bundled Next Route Handlers guide before modifying API routes.
- Do not use actual cloud credentials during tests, run stop.bat, or discard user work.
- Watch each behavior regression fail before implementing. Existing failing mock and lint checks are the red baseline for mechanical fixes.
- Maintain fixed routing selected by local environment; do not alter environment settings.
- Execute continuously under the user's approval; final review before reporting completion. No push is authorized by this new request.

## Task 1: Restore test and lint gates (audit 8/9)

**Files:** `tests/cleaning/useCleaning.restoreRace.test.tsx`, `ocr-service/app/api.py`, `ocr-service/tests/test_pipeline.py`, `ocr-service/tests/test_mask_refiner.py`.

- [x] Reproduce isolated restore error and Ruff I001 failures.
- [x] Give the metadata mock a valid default before each test:
  ```ts
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map());
  ```
- [x] Sort the three import lists as requested by Ruff; do not change logic.
- [x] Run `node node_modules/vitest/vitest.mjs run tests/cleaning/useCleaning.restoreRace.test.tsx --root . --maxWorkers 1` and `ocr-service/venv/Scripts/python.exe -m ruff check app scripts tests` from the sidecar directory. Expect exit 0.

## Task 2: Gemini lifecycle (audit 1/2/3/4)

**Files:** `lib/server/geminiRequest.ts`, `lib/server/geminiTranslationRouter.ts`, `lib/server/geminiCatalog.ts`; translation tests.

**Interfaces:** `ExecuteGeminiTranslationOptions.signal?: AbortSignal`; existing request error code `REQUEST_ABORTED`; persistence remains internal.

- [x] Add tests for headers-before-stalled-body timeout, ignored abort deadline, midflight external cancellation without cooldown, dynamic signal propagation, rejected recovery success, post-claim exceptions, persistence failure, concurrent writes/load.
- [x] Run those tests and confirm red before implementation.
- [x] Keep deadline active through body decoding; race the attempt against timeout/external abort; clean timer and abort listeners in finally. On external abort call `throwIfRequestAborted(signal)` before classifying transport failures.
- [x] Pass `options.signal` to discovery and `requestGeminiRoutes`. Track claimed trial models and release in finally after terminal result, leaving recordSuccess responsible for successful health updates.
- [x] Queue persistence and share a load promise. Catch persistence errors with a credential-free warning so cache IO cannot discard upstream success or abort fallback.
- [x] Run `node node_modules/vitest/vitest.mjs run tests/translation/geminiRequest.test.ts tests/translation/geminiCatalog.test.ts tests/translation/healthAwareGeminiRouting.test.ts --root . --maxWorkers 3`; expect green.

## Task 3: Review state through restore (audit 5)

**Files:** `lib/projectStore.ts`, `hooks/useCleaning.ts`; cleaning persistence/restore tests.

**Interface:** `StoredCleaningResult.awaitingReview?: boolean`; existing `PageCleaningResult.awaitingReview`.

- [x] Add failing tests proving a locally stored awaiting-review page remains flagged after restore, including a legacy record without the field.
- [x] Persist `awaitingReview` with the result; restore explicit value, otherwise derive from `region.status === "needs_review" && region.automaticAction === "clean"` (confirm exact region enum spelling from current types).
- [x] Test the fast local path without a sidecar and verify guarded batch translation sees the flag.
- [x] Run `node node_modules/vitest/vitest.mjs run tests/cleaning/projectStore.test.ts tests/cleaning/useCleaning.test.tsx tests/cleaning/useCleaning.restoreRace.test.tsx --root . --maxWorkers 3`.

## Task 4: Local request boundary and translate shape (audit 6/10)

**Files:** `lib/server/localRequest.ts` (new shared boundary helper), `src/app/api/clean/[...path]/route.ts`, `src/app/api/translate/route.ts`; proxy and translation route tests.

**Interfaces:** helper accepts Request and returns denial Response or null; permit loopback app origins and extension schemes, reject external/opaque/malformed origin before body reads. Requests without Origin remain compatible with local Node clients, validating an available Host/request URL as loopback.

- [x] Test external simple POST denial without upstream IO, legitimate app/extension requests, DNS-rebound hostname and no-Origin local clients.
- [x] Add object/JSON shape tests returning `400` with code `INVALID_REQUEST` and no upstream calls.
- [x] Implement early guard in clean proxy. Parse translate body with an isolated JSON try/catch and object/non-array check before destructuring:
  ```ts
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid translation payload", code: "INVALID_REQUEST" }, { status: 400 });
  }
  ```
- [x] Thread request cancellation into the new dynamic options; preserve streaming delivery semantics and fixed route selection.
- [x] Run proxy, routes, dynamicRoutingRoutes and streaming/cancellation tests.

## Task 5: Safe shutdown ownership (audit 7)

**Files:** `stop.bat`, launcher/server ownership support scripts; `tests/scripts/desktopLauncher.test.ts`, new ownership regression tests.

**Interfaces:** stop path must only terminate a process verified as the workspace's Next server or cleaner, using executable/command path and process identity. Never infer ownership solely from a listening port or console title.

- [x] Test unrelated listener preservation and known server/cleaner selection; no actual Stop-Process in tests.
- [x] Implement verified shutdown using one native PowerShell path. Maintain browser Launcher compatibility, including existing dev-server launches without ownership records by proving command path belongs to this checkout; when proof is absent, skip and report.
- [x] Remove indiscriminate port/window-title kills from stop.bat and keep its user-facing completion message truthful.
- [x] Run launcher/ownership/API shutdown tests.

## Task 6: Final review and verification

- [x] Task reviews and fix any critical/important findings.
- [x] Run full Vitest suite (process exit must be 0), TypeScript, ESLint, pytest without model tests, Ruff and production build. Inspect every result.
- [x] Update audit with per-finding resolution and evidence; preserve original findings as historical baseline.
- [ ] Independent final source review: deferred because reviewer agents hit the account usage limit. Main agent reviewed the remaining diff; initial Gemini review findings were fixed and regression-tested. No real AI/model/browser quality claim.
- [x] Report exact changes, final test counts and remaining verification limits. Keep changes reviewable in the local branch.
