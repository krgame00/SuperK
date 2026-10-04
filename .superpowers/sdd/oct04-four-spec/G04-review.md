### Spec Compliance

- ❌ Issues found: publication validates cached points but sends a different React state array (`src/app/page.tsx:1221`, `src/app/page.tsx:1278`); multipart strip output can leave an incomplete book after an asynchronous evidence change (`src/app/page.tsx:1560`, `src/app/page.tsx:1573`).
- ⚠️ Source-image-only per-point confirmation remains future S03 UI work. G04 correctly blocks missing review evidence; this verdict does not certify all four tickets complete (`lib/export/reviewGate.ts:161`; `S03-report.md`, Integration needs).
- ⚠️ Browser rendered pixels and real reload/export parity cannot be certified from this diff. The reported workspace tests mock the renderer/cleaning/translation hooks (`tests/workflow/workspaceExportEligibility.test.tsx`); report accurately discloses this.

### Strengths

- Exact persisted target policy is used; legacy string identity fails closed, stable source identity and exact contextual review are enforced, and missing background evidence blocks independently (`lib/export/reviewGate.ts:130`, `lib/export/reviewGate.ts:144`, `lib/export/reviewGate.ts:161`).
- Shared gate precedes translated output selection in single, ZIP/CBZ, PDF and strip; fresh offscreen rendering replaces unproven live/cache pixel reuse (`src/app/page.tsx:1304`, `src/app/page.tsx:1352`, `src/app/page.tsx:1500`, `src/app/page.tsx:1792`).
- Post-render and pre-save checks reject accepted text changes after initial eligibility; the explicit async mutation workspace test checks no save occurs (`src/app/page.tsx:1398`, `src/app/page.tsx:1803`; `tests/workflow/workspaceExportEligibility.test.tsx`, final test).
- Hard blockers cannot be cleared by generic page confirmation. Explicit original substitution and exclusion preserve original page indices and show affected pages (`lib/export/reviewGate.ts:229`; `src/app/page.tsx:1325`, `src/app/page.tsx:1334`, `src/app/page.tsx:1683`).

### Issues

#### Critical (Must Fix)

- None identified.

#### Important (Should Fix)

- `src/app/page.tsx:1278`: publish-back gates and signs `bubbleCacheRef.current.get(page.url)` but posts captured `activeBubbles`. These are separate storage/state values; an initially different array can pass the cache gate and publish unreviewed/stale text, and a cache replacement after the handler's render can leave the captured payload older even when the current cache passes. Capture the actual publication point snapshot, validate and sign that snapshot against current cache/source/target/background, and send those exact points. Add a workspace test where cached accepted points differ from active points, plus an accepted replacement during the pairing-token await. The existing successful publication test leaves activeBubbles empty while populating cache, so it already exercises the discrepancy without asserting payload contents.
- `src/app/page.tsx:1560`: strip chunks are saved individually inside the chunk loop. If text/evidence changes during the await that saves chunk 1 (or during construction of chunk 2), the next assertion rejects, but chunk 1 has already escaped and the user receives an incomplete book. This does not fulfill the no incomplete translated output requirement under the specifically required asynchronous mutation race. Stage every strip blob and verify the full set before emitting a single archive, or define and implement a transactional publication boundary for the multipart set. Add a two-chunk test with mutation during the first publication await and assert no partial book is released.

#### Minor (Nice to Have)

- G04-report.md records Node experimental localStorage warning and pre-existing page lint warnings. The focused test cleanup removed React act/expected-error noise; remaining environmental warning is acknowledged, not evidence of a functional failure.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The output gate substantially improves evidence binding and blocks the documented stale approval/cache bypasses. Publication must bind its actual payload, and multipart strip release needs a coherent failure boundary before the claimed all-output guarantee is trustworthy.

**Review checks:** Read supplied diff package with bounded slices because the initial tool output truncated. Read the complete offscreen function at `src/app/page.tsx:1351`–`1426` because diff hunks omitted its middle. Named outside-diff risk: cache versus active publication points; focused `rg` of hook state/cache writes confirms they are separate values. Read S03/R01 reports only for stable source fingerprint and current remnant accessor interface claims. No git commands, tests, production edits, index or branch changes performed. Review report is the sole created file.

## Fix re-review — 0f3af12 → 0f0c010

### Spec Compliance

- ✅ Spec compliant for the reviewed G04 scope. Both prior Important findings are resolved: publication gates/posts the same cache snapshot (`src/app/page.tsx:1241`, `src/app/page.tsx:1299`), and multipart strip stages all chunks into one archive before a single final release (`src/app/page.tsx:1564`, `src/app/page.tsx:1607`, `src/app/page.tsx:1623`).
- ⚠️ Source-image-only manual approval UI remains future S03 work; missing contextual evidence still blocks. This approval is G04 only, not completion of all four tickets.
- ⚠️ Real browser pixel rendering and real reload/export are not verified by this static review or the mocked workspace renderer tests. Existing reported limitation stands.

### Strengths

- Authoritative points are copied before publication, checked with current persisted target/source/background, and sent with G05 identity fields. Signature/gate checks after pairing prevent accepted cache replacement from publishing an older snapshot (`src/app/page.tsx:1241`, `src/app/page.tsx:1286`, `src/app/page.tsx:1299`; `tests/workflow/workspaceExportEligibility.test.tsx:377`).
- Strip construction, blob conversion and archive packaging complete before final whole-book assertion and one save; single strip retains its JPEG behavior. Public menu text explains multipart ZIP (`src/app/page.tsx:1564`, `src/app/page.tsx:1607`, `src/app/page.tsx:1623`; `components/workspace/WorkspaceExportMenu.tsx:64`).
- Live source-box evidence is passed at every gate/signature/UI accessor, preventing approval reuse during setter-effect lag (`src/app/page.tsx:463`, `src/app/page.tsx:1338`, `src/app/page.tsx:1371`, `src/app/page.tsx:3130`). Hook rejects expected evidence mismatch synchronously; binding/cache identity includes source context and box geometry (`hooks/useCleaning.ts:276`; `lib/cleaning/backgroundRemnantInspection.ts:69`, `lib/cleaning/backgroundRemnantInspection.ts:330`).
- Regression assertions cover actual posted cache points, deferred pairing replacement, two-chunk single ZIP release, mutation during second chunk construction with zero saves, and live changed-box rejection before the effect (`tests/workflow/workspaceExportEligibility.test.tsx:373`, `tests/workflow/workspaceExportEligibility.test.tsx:377`, `tests/workflow/workspaceExportEligibility.test.tsx:394`, `tests/workflow/workspaceExportEligibility.test.tsx:435`).

### Issues

#### Critical (Must Fix)

- None identified.

#### Important (Should Fix)

- None identified in this fix scope; previous two Important findings are resolved.

#### Minor (Nice to Have)

- Existing environmental localStorage warning and pre-existing lint warnings remain disclosed in G04-report.md; no new functional defect inferred.

### Assessment

**Task quality:** Approved.

**Reasoning:** The release boundary now binds the publication payload and makes multipart strip output indivisible. Expected live source-box evidence closes the background approval effect-lag gap without coupling background confirmation to generated-text approval.

**Review checks:** Static review of supplied integration-fix-review.diff and updated G04-report.md; bounded slices recovered truncated output. No git commands, suite/test reruns, production edits, index or branch changes. Only this review report was appended. Reported focused G04 33 tests and parent 91 tests are controller/implementer evidence, not rerun by this reviewer.
