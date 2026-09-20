# Post-mortem: npm 12 package-lock peer consistency

## Summary

The Approved Cleanup clean-install gate was blocked because npm 12 rejected the existing `package-lock.json` as incomplete. The lockfile omitted peer-dependency packages required by active dependencies, so `npm ci` could not reproduce the dependency tree. The repair regenerated lock metadata only, preserving the root manifest and all existing package versions, then revalidated the project in a fresh isolated copy. Tracking is the current uncommitted `main` working tree plus `docs/superpowers/plans/2026-09-19-approved-cleanup.md`; no PR or ticket was provided for this local fix.

## Symptom

Normal `npm ci` failed with `EUSAGE` and reported missing lock entries including `webpack@5.111.1`, `electron-builder-squirrel-windows@26.15.3`, `electron-winstaller@5.4.0`, and their transitive dependencies. The same command with `--legacy-peer-deps` succeeded in dry-run mode.

## Root cause

The saved lockfile encoded a dependency tree produced with peer-dependency omission semantics. Active packages still declared those peers:

- `@ducanh2912/next-pwa` declares a Webpack peer requirement.
- `app-builder-lib` declares `electron-builder-squirrel-windows@26.15.3` as a peer.

npm 12 validates those peer packages as part of the reproducible `npm ci` tree. Because their package entries were absent from `package-lock.json`, npm rejected the lockfile before installation. The same missing-entry failure was reproduced against the saved pre-cleanup manifests, so the inconsistency predated the Approved Cleanup removals.

## Why it produced the symptom

`npm ci` does not repair an incomplete lockfile. It requires `package.json` and `package-lock.json` to describe a complete installable tree. npm 12 therefore stopped at lock validation and never reached the build or test stages.

## Fix

A lock-only repair was generated in an isolated copy with npm 12. Relative to the pre-repair cleanup lockfile, the repair:

- added 54 missing peer/transitive package entries;
- removed 0 package entries;
- changed 0 existing package versions;
- left the root package dependency manifest unchanged.

The repaired lockfile was then copied back as the only dependency-resolution repair. No `--legacy-peer-deps` workaround was adopted.

The isolated full test run also exposed an unrelated test-hermeticity gap: `tests/desktop/sidecar.test.ts` mocked process launch but still read the real filesystem to decide whether the Python runtime existed. The test now injects the already-supported `existsSync` seam as `() => true`; production sidecar behavior is unchanged.

## How it was found

1. Reproduced normal `npm ci` failure in an isolated source copy.
2. Ran `npm ci --legacy-peer-deps --dry-run`; it succeeded, isolating the difference to peer-dependency resolution.
3. Traced the missing peers to `@ducanh2912/next-pwa` and `app-builder-lib`.
4. Generated a lock-only candidate and compared package maps before applying it.
5. Confirmed the candidate added missing entries without removing packages or changing existing versions.
6. Re-ran normal clean installation and downstream verification in a source copy without pre-existing `node_modules`, `.next`, or real environment files.

## Why it slipped through

The existing developer `node_modules` tree allowed local build and tests to run even though the committed lockfile was not reproducible under current npm 12 peer resolution. Earlier verification did not include an exact clean `npm ci` gate, so the stale lock metadata remained latent.

The sidecar test had a similar environment assumption: it mocked child-process behavior but not runtime existence, so a developer machine with `ocr-service/venv` hid the dependency.

## Validation

Fresh isolated copy:

- `npm ci --no-audit --no-fund --allow-remote=all`: exit 0; 915 packages installed.
- `npm run build`: exit 0; production Next.js build completed.
- `npx tsc --noEmit`: exit 0.
- Focused sidecar + Workspace tests after the test-hermeticity repair: 2/2 files, 22/22 tests passed.
- Final isolated `npm test`: **141/141 files, 844/844 tests passed**.

Fresh main working-tree `npm test` also passed **141/141 files, 844/844 tests** before the test-only sidecar hermeticity adjustment.

## Action items

None — the fix itself closes the clean-install verification gap and makes the mocked sidecar unit tests independent of a developer-local Python runtime. No separate follow-up owner or tracking ticket is required for this incident.
