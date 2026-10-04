# G04 resumed output integration

Owned paths: `src/app/page.tsx`, `lib/export/reviewGate.ts`, `tests/export/reviewGate.g04.test.ts`, `tests/workflow/workspaceExportEligibility.test.tsx`.

Preserved the interrupted dirty implementation and completed the existing workspace seams. Persisted PageTargetIdentity is checked without synthesizing a new policy. Contextual snapshots require exact raw source/text, current target/policy and stable original source fingerprint; missing or legacy numeric source identity blocks. Missing cleaning/background evidence blocks translated and clean output. Background evidence comes from R01's synchronous getCurrentRemnantReview accessor, which rejects changed source/background/removal bindings. Original substitution and exclusion remain explicit and export order/numbering remains unchanged.

Every format checks before output selection. Unproven live canvas/cache pixels are no longer used: single and book translated output use one fresh offscreen renderer. The renderer rechecks eligibility and exact input signature after its asynchronous work. Single/book save and publication recheck after awaits; no failed render can save a partial book. Cached pixels are not approval evidence.

R01 page UI integration: actual RemnantReviewPanel receives current inspection, exact artwork confirmation callback, explicit local recheck, and opens MaskEditor with clean comparison URL and bounded candidate focusRect. Opening a finding does not call resolveMaskRegion or cleaning.

RED: added `requires absent background evidence and rejects old saved policy`; `node node_modules/vitest/vitest.mjs run tests/export/reviewGate.g04.test.ts --reporter=dot` failed with expected false->true at missing background assertion (14 existing passed, 1 failed). Subsequent stricter fixtures explicitly supply current policy/source/background; old expectations were not treated as approval evidence.

GREEN: `node node_modules/vitest/vitest.mjs run tests/export/reviewGate.g04.test.ts tests/workflow/workspaceExportEligibility.test.tsx --reporter=dot` passed 2 files / 29 tests. Actual workspace actions cover ZIP/CBZ/PDF/strip/single missing background before cache/live/offscreen access, deterministic script/old accepted state, explicit original/exclusion ordering, missing point review/release, publish-back, real remnant panel->bounded MaskEditor callback, and accepted text mutation during asynchronous single render prevents save. Pure tests include control-only lettering, stale policy/source and independent background confirmation.

`node node_modules/typescript/bin/tsc --noEmit --pretty false` exit 0.

`node node_modules/eslint/bin/eslint.js src/app/page.tsx lib/export/reviewGate.ts tests/export/reviewGate.g04.test.ts tests/workflow/workspaceExportEligibility.test.tsx` exit 0; pre-existing page warnings remain (unused directory picker/reviewFlaggedPages and hook dependencies).

Limits: no provider run, live browser restart, full suite, index operation or commit. Workspace tests use real page event handlers with mocked translation/cleaning hooks and offscreen callback; they do not claim a real browser pixel render. Source-free image-only contextual review and S03 saved-size controls remain next integration work, owned by S03 after root review/page handoff. G04 gate fails closed until that explicit image review evidence exists.

Test cleanup follow-up: explicit original substitution and per-point confirmation release await the actual successful export state within asynchronous act; no sleeps. The asynchronous mutation rejection asserts exactly one expected console warning and restores the spy, forwarding any unrelated warnings. Re-ran `node node_modules/vitest/vitest.mjs run tests/export/reviewGate.g04.test.ts tests/workflow/workspaceExportEligibility.test.tsx --reporter=dot`: 2 files / 29 tests passed, no React act warnings or expected-error stack noise. Node's existing localStorage experimental warning remains. `node node_modules/eslint/bin/eslint.js tests/workflow/workspaceExportEligibility.test.tsx` exit 0, no warnings. Page remained frozen throughout this cleanup.
