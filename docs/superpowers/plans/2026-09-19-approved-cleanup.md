# Approved Cleanup Implementation Plan

**Goal:** Remove confirmed dormant helpers and validate dependency cleanup independently of the working installation.

**Architecture:** Preserve production behavior and the retained editor. Remove only dormant exports and their dedicated tests, then copy current source without dependencies, build artifacts, or credentials into an isolated validation directory.

**Tech Stack:** TypeScript, Next.js, npm, Vitest.

- [x] Confirm user agreement in docs/cleanup-design-review.md.
- [x] Recheck clearAssets and generatePageFilename references across source, scripts and tests; neither has a production caller.
- [x] Remove clearAssets from lib/projectStore.ts. Keep persistence schema and active asset operations.
- [x] Remove generatePageFilename from lib/export/exportManager.ts and its two dedicated tests/import. Keep active filename/export helpers.
- [x] Create an isolated source copy with package-lock.json; no existing node_modules, .next, or real environment files.
- [x] Attempt npm ci from the lockfile without bypassing lock consistency. Record install blockers rather than silently regenerating dependencies.
- [x] Run production build, TypeScript and the full Vitest suite against the isolated installation after lock repair.
- [x] Run local checks for changed source; report separately from clean-install validation.
- [x] Record removed/retained items and unresolved validation. Do not declare dependency cleanup verified if clean install/build cannot finish.

Validation closed: the pre-existing npm 12 peer-dependency lock inconsistency was
repaired without changing root dependencies or existing package versions. A fresh
isolated `npm ci` completed successfully, followed by a successful production build,
`npx tsc --noEmit`, and the full Vitest suite (**141/141 files, 844/844 tests**).
The isolated run also exposed that `tests/desktop/sidecar.test.ts` depended on a real
local Python runtime despite mocking process launch; the test now injects the existing
`existsSync` seam so the suite is hermetic without changing desktop production behavior.
See `docs/unused-code-cleanup.md`.
