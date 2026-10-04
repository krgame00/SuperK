# G06 integrated acceptance — verification in progress

Date: 2026-10-04. Branch: `codex/translation-completeness`.

The implementation tickets are integrated and reviewed. This final gate runs a full suite and isolated production build. No provider calls, user manga access, push, or live service restart were performed.

## Regressions fixed during integrated acceptance

- Next App Router rejects helper/test exports from route modules. HTTP route methods now live in sibling `handler.ts` modules; route modules expose only supported HTTP methods. `tests/server/routeExports.test.ts` locks this contract.
- Workspace tests referred to an obsolete direct-download path, matched ZIP controls inside the Strip label, and ignored fresh canvas rendering. Assertions now follow the current saveBlob and render callbacks; mixed exports require explicit original selection and real review confirmation.
- Review regressions caught three data-path defects: autosave omitted the reader source fingerprint; cleaning Undo/Redo changed only memory; extension layout snapshots lost explicit line breaks. Fingerprints are now persisted, mask/history writes are serialized per page, and the reader preserves verified multiline layouts.
- A pending export confirmation previously resumed with the pre-confirmation React closure. The synchronous confirmation ref ensures the resumed action sees the newly confirmed signature.
- Artwork and whole-image confirmations now use the same serialized page write as clean assets/history. A regression test delays asset persistence, confirms the exact current image, then verifies the resulting metadata keeps that confirmation.
- Extension snapshots now tolerate whitespace consumed by legitimate wrapping while still requiring exact displayed-text identity and rejecting foreign or altered characters. Thai newline, Thai spaced-phrase, and English word-wrap fixtures retain the stored size and lines.

## Verification results

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --pretty false` passed after the final persistence changes.
- Focused final regression selection: 6 test files / 70 tests passed, including WorkspacePage, autosave identity, Undo/Redo persistence, image confirmation during delayed saves, and strict extension snapshots.
- Complex real-font browser check: 9 source-size comparisons and 4 overlay/export/reopen checks passed. Size matched the source at 44%, 100%, and 150% presentation zoom; export embedded translated text; reopening preserved layout.
- Isolated production build: webpack compile, generated TypeScript, 17 static pages, and all API routes passed. The isolated production app returned HTTP 200; 13/13 referenced static assets loaded.
- Changed TypeScript/JavaScript ESLint scope: 0 errors, 15 warnings (unused imports/vars, existing callback/dependency notices, and two fixture warnings). Classic extension scripts are ignored by repository ESLint configuration. These warnings are reported rather than treated as failures.
- Full repository Vitest run (`--maxWorkers 1`) completed: 1,740 passed / 4 failed across 453 test files. Three failures exposed stale Strip-label assertions, an incomplete flush in the delayed-save regression test, and an assertion sensitive to the expected console diagnostic. The affected focused selection was corrected and rerun: 39/39 passed. The remaining failure invokes `cscript.exe` from the VBScript syntax test; the binary exists, but this process environment returns a launch error. The PowerShell launcher checks and all other launcher tests passed.
- Dense-page synthetic timing reports from earlier P01–P03 runs remain the performance evidence. The Electron GPU process cannot initialize in this environment; those measurements use software raster and are not a compositor/input-to-photon claim.

## Service and workspace state

- Live service on port 3000 was not restarted. A previous accidental root build removed some root `.next` artifacts before failing on a Windows file lock; the user-facing service remained HTTP 200. The successful isolated build was kept in `.scratch/g06-isolated-webpack` and not copied over the running standalone checkout.
- Do not claim the current live browser is using this build. The service can be updated after the user confirms current work is saved.
- Preserve the unrelated dirty library/archive documentation and plans already present in the workspace. Do not push.
