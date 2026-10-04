# R02 mask resolution and exact image confirmation

Status: implemented; G06 still owns integrated browser/build acceptance.

## Changes

- Applying a mask correction records immutable before/after clean, mask, review-mask and protected-mask blobs in workspace Undo/Redo. Restores create fresh object URLs, re-inspect locally, invalidate in-flight work and never call cleaning providers.
- History restore is scoped to the active workspace, page membership/identity, original source revision and text-evidence identity. Removed pages cannot be mutated by stale commands.
- Unverified background detection has a separate whole-image compare and explicit human acknowledgement. Both original and clean assets must load; the stored acknowledgement is bound to the exact source, mask and evidence revision. Existing candidate artwork approval remains per candidate.
- Missing original pixels remain unavailable and show a re-import action; they cannot be approved as clean.
- The panel can compare source boxes outside the removal mask in read-only mode and navigate to actual mask correction separately.

## Verification

- Actual hook Undo/Redo test restores clean blobs and exact scoped findings, without reclean calls; also verifies removed-page history is ignored.
- Unavailable detection test verifies a distinct exact-image acknowledgement and rejects missing-source confirmation.
- Focused mask/hook/store tests: 3 files, 27 tests passed. Full R-wave/dense-extension integration selection: 34 files, 311 tests passed.
- TypeScript passed; scoped ESLint has only existing warnings recorded in the R03 report.

## Limits

- Human whole-image acknowledgement means the operator checked this exact source/clean/mask revision; it is not a claim that the detector found every possible artifact.
- No production service was restarted. G06 owns browser-level page-order, reload and build checks.
