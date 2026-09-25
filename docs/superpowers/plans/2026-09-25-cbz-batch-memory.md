# CBZ Batch Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Chrome memory bounded while translating a 30–100 page CBZ and preserve saved work after a crash or reload.

**Architecture:** Remove full-book Base64 concatenation from render. Introduce short persistent page identities and store source image bytes as IndexedDB Blob assets, with legacy data-URL migration. Keep existing translation and cleaning semantics while measuring batch memory at page checkpoints.

**Tech Stack:** Next.js 16 Client Components, React 19, TypeScript, IndexedDB, Vitest, fake-indexeddb.

## Global Constraints

- Preserve existing user translations, edits, cleaning results, exports, and page order.
- Do not change Gemini routing or cleaning model selection.
- A failed asset write must not make the previous saved session unusable.
- Do not call the crash fixed without a successful real CBZ run and browser memory measurement.

---

### Task 1: Remove full-book string allocation during progress rerenders

**Files:** `hooks/useTranslation.ts`, `tests/translation/useTranslation.monotonicAutosave.test.tsx`

**Interfaces:** The existing `pages: string[]` prop remains stable in the workspace; autosave observes array identity rather than a concatenated data-URL string.

- [ ] Add a regression test with large data URLs that rerenders the hook during a batch progress update and asserts no whole-book concatenation and no unrelated autosave.
- [ ] Run `npx vitest run tests/translation/useTranslation.monotonicAutosave.test.tsx` and confirm the new assertion fails.
- [ ] Remove `pages.join("|")` from render and use the memoized page list as the autosave dependency.
- [ ] Run the focused suite again and confirm it passes.

### Task 2: Compact durable page and render identities

**Files:** `lib/projectStore.ts`, `hooks/useTranslation.ts`, `src/app/page.tsx`, `tests/cleaning/projectStore.test.ts`, related restore tests.

**Interfaces:** `saveProjectSession` receives optional stable `page.id`; source Blob assets use `source_<id>`, translated render assets use `translated_<id>`. Legacy data-URL sessions load and migrate on save.

- [ ] Add fake-indexeddb tests proving a multi-page source can save, reload, and retain bubbles without image-sized session metadata or asset keys; test a legacy session and a failed asset write.
- [ ] Run the tests and confirm expected failures.
- [ ] Pass stable page IDs from the workspace into autosave. Persist source Blobs before compact session references, and map restored entries back to runtime page URLs and bubble/render keys. Avoid rewriting unchanged source Blobs.
- [ ] Run project-store, cleaning-restore, translation-restore, and export tests; fix any contract regression before proceeding.

### Task 3: Bound translation render residency

**Files:** `hooks/useTranslation.ts`, `lib/translationOverlay.ts`, `lib/lifecycle/workspaceResourceManager.ts`, focused translation/export tests.

**Interfaces:** The current and nearby translated renders remain available; old full-page results are persisted as Blob assets and re-rendered or restored on demand. Temporary canvas backing stores are released after encoding.

- [ ] Add a test that translates more pages than the warm/cache limit and verifies old page results remain exportable after eviction.
- [ ] Run the test and confirm the intended failure.
- [ ] Remove duplicate large render residency and release per-page temporary canvas resources after encoding, without clearing active edits.
- [ ] Run focused translation/export tests and TypeScript.

### Task 4: Verify the browser workload and record evidence

**Files:** `docs/AI-WORKING-NOTES.md`, this plan.

- [ ] Run a synthetic 30–100 page CBZ through import, batch translation with stubbed Gemini responses, save, reload, and export; record Chrome renderer memory at page 1/20/50/last and compare with baseline.
- [ ] Run the user's original CBZ if its path is available. Record peak and settled Chrome memory, pages completed, crash/recovery outcome, and any limitations.
- [ ] Run `npx tsc --noEmit`, focused suites, and the full Vitest suite after the final change.
- [ ] Update this plan and `docs/AI-WORKING-NOTES.md` with actual pass/fail evidence; only mark verified when the original crash scenario no longer occurs.
