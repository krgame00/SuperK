# Unused code cleanup — first batch

Removed `@vitejs/plugin-react` and `vite-tsconfig-paths` from package.json and
package-lock.json after checking source, scripts, config and reverse dependency
references. Vitest uses its configured alias directly; neither plugin is loaded.
Also removed the exclusive lock entries for `globrex` and `tsconfck`.
Shared dependencies (including `@rolldown/pluginutils`) retain their versions.

Removed the unused `flushCleanerMemory` and `purgeOldCleanerJobs` client wrappers
and their two wrapper-only tests. No production callers exist. SettingsModal's
purge action still calls its endpoint directly. Backend endpoints are unchanged.

The editor components, their dependencies and tests remain available. This batch
does not delete source images, model files, saved work or cache directories.

Npm uninstall could not finish offline because of missing cached peer metadata
and cache permissions. The manifest/lock update was applied narrowly instead;
npm Arborist successfully loaded the resulting virtual tree, and retained lock
entries were checked against the backup. No clean install was performed and old
package directories may remain in the existing node_modules until reinstall.

Verification logs: `scratch/cleanup-full-tests.log` and
`scratch/cleanup-types.log`. The test count decreases by two because only tests
of the removed wrappers were removed, not tests of active behavior.

## Approved second batch and clean-install validation

Following the confirmed cleanup-design-review.md decisions:

- Removed clearAssets: no application or test caller; active session persistence
  and asset schema remain intact.
- Removed generatePageFilename and its two dedicated tests: production export
  uses other filename paths. Active filename helpers remain intact.
- Retained the editor, benchmarks and ambiguous candidates. No public images,
  models, job caches or saved work were removed.

Local verification: 141 test files / 844 tests passed; TypeScript passed; scoped
git diff --check passed. Logs: scratch/cleanup-approved-tests.log and
scratch/cleanup-approved-types.log.

Clean-install validation is now complete. The pre-existing npm 12 lockfile
inconsistency was traced to peer dependencies omitted from the saved lockfile,
including `webpack` required by `@ducanh2912/next-pwa` and
`electron-builder-squirrel-windows` required by `app-builder-lib`. A lock-only
repair added the missing peer/transitive entries without changing the root
manifest or any existing package version. The repaired lock passes normal
`npm ci` semantics without `--legacy-peer-deps`.

Fresh isolated validation used a source copy with no existing `node_modules`,
`.next`, or real environment files. Results:

- `npm ci --no-audit --no-fund --allow-remote=all`: passed; 915 packages installed.
- `npm run build`: passed; Next.js production build completed and generated all routes.
- `npx tsc --noEmit`: passed.
- `npm test`: passed; **141/141 test files, 844/844 tests**.

The first isolated full-test run exposed a test-environment dependency in
`tests/desktop/sidecar.test.ts`: process launch was mocked, but Python runtime
existence still used the real filesystem. The test now injects the existing
`existsSync` seam as `() => true`, preserving production behavior while making
the unit test independent of a developer-local `ocr-service/venv`. A transient
WorkspacePage Space-toggle failure from that first loaded run did not reproduce
in focused isolated testing, the fresh full main-repo run, or the final isolated
full suite.

The cleanup therefore has clean-install, production-build, TypeScript and full
suite evidence. Existing jsdom canvas/React test warnings remain warnings rather
than failing assertions and were not expanded into this cleanup scope.

## Follow-up unused files cleanup

Executed the 4 surgical unused file deletions planned in `docs/superpowers/plans/2026-09-20-unused-files-cleanup.md`:

- `components/workspace/MobileToolsMenu.tsx`: Removed unused mobile tools menu component with 0 production or test callers.
- `lib/lifecycle/sessionSpillCache.ts` & `tests/lifecycle/sessionSpillCache.test.ts`: Removed orphaned in-memory spill cache utility and its 4 dedicated tests; documented in `docs/ram-render-cache-fix.md`. WorkspaceResourceManager retains standard cache-miss eviction behavior.
- `lib/server/rateLimiter.ts` & `tests/server/rateLimiter.test.ts`: Removed disconnected server rate limiter helper and its 11 dedicated tests; removed unused `resetRateLimits()` test hook from `tests/translation/routes.test.ts`. Active route behavior and request limits remain unchanged.
- `ocr-service/app/cache.py`: Removed unused `ResultCache` abstraction and its dedicated test in `test_pipeline.py`. Maintained pipeline version contract verification in `test_api.py` via `test_api_reports_pipeline_version`. Active jobs storage under `cache_dir / "jobs"` is untouched.

Retained all 10 editor components, benchmarks, models, caches, and user data.

Verification evidence:
- TypeScript (`tsc --noEmit --incremental false`): passed with 0 errors.
- Vitest suite: **139 test files / 831 tests passed** (4 tests removed from sessionSpillCache + 11 from rateLimiter; 846 -> 831).
- Python non-model suite: **176 passed, 3 deselected** (1 test removed from test_pipeline; 177 -> 176).
- Production build (`npm run build`): passed with exit code 0.
- Scoped `git diff --check`: passed.
