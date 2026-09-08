# System review — 2026-09-08

Status: initial code review and agreed product requirements recorded together. Fixes and further runtime validation remain outstanding.

## Review scope

- Serve a small trusted team.
- Preserve artwork, accepting residual text where removal is uncertain.
- Prioritize correct results and avoiding lost work.

The review covers the current local installation, workspace, cleaning backend, extension integration, persistence and export paths. Deployment issues are conditional findings for shared hosting.

## Agreed requirements

The user confirmed these requirements during the review. They describe the intended behavior; they are not claims that the current implementation already satisfies it.

- Support a small trusted team through local installations for now. Access from anywhere remains a future direction.
- Preserve artwork even when uncertain text remains.
- Recover after refresh or unexpected app closure to the latest successfully saved state, clearly showing changes that are still unsaved. Browser-data deletion and device migration are outside the current recovery guarantee.
- Retain the assets needed for region cleaning and retry until the project is deleted, so older projects remain editable after several days.
- Require human confirmation before exporting pages with uncertain cleaning or translation results. Confirmation applies to the reviewed image and text; changing either requires confirmation again.

The architectural rationale is also recorded in [ADR 0002](adr/0002-local-project-recovery-and-review.md), and the review terminology is defined in [CONTEXT.md](../CONTEXT.md).

## System traced

Browser workspace imports pages, calls the Next.js translation and cleaning APIs, edits overlays, persists a session in IndexedDB, and renders image/book exports. The Python service detects text, builds protected masks, cleans and verifies regions, and retains job assets for retries. The extension maintains reading results and exchanges settings, handoffs, and explicit publications with the workspace through API routes.

Simpler alternative to expanding features: stabilize the existing edit/save/export contract first. A shared server should depend on an explicit team deployment decision, because current extension state is global in-memory state and workspace sessions are browser-local.

## Findings ordered around preserving work

1. **P1 — Failed re-clean can discard an existing translation.** `src/app/page.tsx:155` awaits `cleanCurrentPage` and then unconditionally invalidates the translation. `hooks/useCleaning.ts:278` returns void and catches cleaning errors. `hooks/useTranslation.ts:1301` deletes bubble and rendered-image caches. Return a success result or propagate failure, and invalidate only after successful replacement. Static call-path finding; not reproduced in the browser.

2. **P1 — Direct overlay edits do not reliably trigger persistence or refresh exported images.** `lib/translationOverlay.ts:799`, `:858`, and `:890` notify mutation; the restored-page callback at `hooks/useTranslation.ts:294` only calls `markPageDirty` (`:254`), mutating a ref without advancing the autosave dependencies (`:414`). The rendered image is also retained, and `src/app/page.tsx:666` prefers that cache for a non-current page export. Schedule a save revision and invalidate derived render data for each edit, undo, and redo. Static call-path finding.

3. **P1 — Dirty changes arriving during a save can be cleared.** `hooks/useTranslation.ts:341` aliases the mutable dirty Set instead of capturing independent revision information. The success filter at `:358` compares against that same Set and can discard additions made during the await. Track per-page versions so that a successful write clears only the version actually saved, including repeated edits to the same page. Static concurrency finding.

4. **P2 — Autosave drops the reading-site association.** `lib/projectStore.ts:459` stores `originUrl`, but `hooks/useTranslation.ts:346` reconstructs saved pages with only URL and name. After reload, the publish-back guard at `src/app/page.tsx:595` and button visibility cannot find the association. Preserve page metadata through autosave.

5. **P1 — Publication polling can replay old editor results over later reading changes.** `src/app/api/extension/publish-back/route.ts:112` includes entries equal to the cursor; `chrome-extension/background.js:238` processes them again without excluding already applied versions. The review agent's isolated Node VM check fetched one record three times and observed three cache writes and broadcasts. This can reverse a delete or overwrite a later retranslation. Use stable publication identities/version tracking and ignore already applied records.

## Backend and deployment boundaries

- The protection pipeline excludes protected pixels (`ocr-service/app/pipeline.py:322`), restores them in candidate images (`:210`), and rolls back failed verification with `NEEDS_REVIEW` (`:263`). This supports the chosen policy; real-page accuracy remains unmeasured in this review.
- Completed job assets default to 24-hour retention (`ocr-service/app/settings.py:20`), while region retry reads parent assets (`ocr-service/app/jobs.py:400`). Once those assets expire, retry cannot reconstruct the parent job from them. This conflicts with the agreed requirement to preserve region retry until project deletion.
- A watchdog changes status without stopping inference (`ocr-service/app/jobs.py:336`). With one default worker, permanently stuck inference can leave later jobs queued. Conditional static failure-path finding.
- The extension settings API returns the server Gemini key (`src/app/api/extension/settings/route.ts:101`); settings, handoffs and publications are shared in-memory state. Before shared hosting, define access control and ownership rather than assuming trust separates users' data.
- Compose does not set `SUPERK_CLEANER_URL`, so the frontend proxy's localhost default targets its own container. Backend Docker excludes `models`, including its required manifest. These are deployment blockers if the team selects Docker/shared hosting.

## Validation and limits

- Web suite: 79 files, 367 tests passed using `node node_modules/vitest/vitest.mjs run --root . --reporter=dot`.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false` passed.
- The web run emitted React act and missing canvas implementation warnings; passing mocked tests do not validate real rendering quality or these uncovered paths.
- `npm test` launcher could not find its npm-cli.js; direct Vitest invocation worked.
- Python tests could not start because the existing venv points to an unavailable interpreter. No Python runtime validation, live provider calls, Docker build, or browser end-to-end/visual audit completed.
- No implementation files changed. Existing untracked utility scripts were left untouched.

## Additional extension findings

- Workspace settings have no production POST caller to the separate extension settings registry (`src/app/api/extension/settings/route.ts:48`); the extension translation request (`chrome-extension/server.js:37`) omits the workspace user key and glossary. Settings parity is incomplete.
- The cleaner returns raw Base64 (`chrome-extension/server.js:228`), forwarded as `cleanUrl` (`content.js:440`), whereas handoff persistence accepts only a data URL (`lib/projectStore.ts:474`). The cleaned asset is lost on that normal handoff path.
- Reading overlays have unconditional cleanup after 120 seconds (`chrome-extension/content.js:521`). Cached-result restoration only scans initial images (`:663`), leaving later lazy-loaded images unrestored. These need browser validation against representative reading sites.

## Combined implementation priorities and acceptance criteria

1. **Prevent lost edits and stale output.** Reproduce and fix failed re-clean invalidation, direct edit persistence, concurrent save tracking, and stale export rendering. A failed clean must preserve the previous translation; edits, undo and redo must update persistence and derived images. Refresh or unexpected closure must restore the last successfully saved revision, and unsaved or failed writes must never be shown as saved.
2. **Keep retained projects editable.** Tie the assets required for cleaning and region retry to project lifetime. Reopening after several days or a service restart must preserve region retry. Validate project deletion and shared asset references so deleting one project does not damage another retained project.
3. **Confirm the actual revision being exported.** Persist review state for uncertain pages, require human confirmation before export, and invalidate that confirmation after image or text changes. Verify every export entry point uses the same rule. This is agreed new behavior; its absence has not been separately reproduced as a defect in this review.
4. **Repair extension parity and handoff.** Fix settings synchronization, cleaned-image transfer, publication deduplication and source metadata persistence. Validate real reading/editing flows, including reload, deletion and retranslation, so stale results do not overwrite later work.
5. **Validate operational boundaries.** Test stuck-worker behavior and remaining backend findings in the actual runtime. Resolve access control, user ownership and Docker issues before shared hosting; local stabilization remains the immediate scope.

No application code was changed as part of this review. Overall current verdict: fix before team rollout, chiefly because edit/save/export can lose or revert user work.
