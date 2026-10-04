### Spec Compliance

- ❌ Issues found: actual R01 integration omits existing text evidence outside removal regions (hooks/useCleaning.ts:324; lib/cleaning/remnantReview.ts:183). This misses ticket R01's first requirement and can approve a background while known source text remains outside the scanned bounds.
- ⚠️ This review covers R01 at base 9d09b4b / head 0f3af12. Adjacent R02 is partial, as .superpowers/sdd/oct04-four-spec/R02-report.md:3,11 correctly states. Whole cleaned-image/mask Undo/Redo and unavailable-evidence human resolution are not certified here; tests/cleaning/remnantReview.test.ts:300 exercises a confirmation store, not workspace history.
- ⚠️ Existing pure detector limitations remain applicable; the explicit v2 preservation change is intentional (lib/cleaning/backgroundRemnantInspection.ts:21,422). An inspected-empty result is heuristic evidence within inspected bounds, not perfect text recognition (components/cleaning/RemnantReviewPanel.tsx:90).

### Strengths

- Actual inspection decodes original bytes and stored cleanBlob separately, without overlay composition or pixel rewriting; truncated RGBA fails closed (lib/cleaning/remnantReview.ts:101,113,189; tests/cleaning/remnantReview.test.ts:24).
- The current-review accessor binds result/blob references, source/mask fingerprints and authorization; pending decode publication repeats those checks and rejects obsolete tokens (hooks/useCleaning.ts:269,299,330). Actual hook tests cover same-URL source replacement and a mask edit during pending decoding (tests/cleaning/useCleaning.remnantReview.test.tsx:181,197).
- Saved opening no longer falls back to provider hydration; local missing assets remain unavailable (hooks/useCleaning.ts:928; tests/cleaning/useCleaning.remnantReview.test.tsx:157). Artwork confirmation cannot clear unverified inspection (hooks/useCleaning.ts:365).
- v2 keeps preserved/protected ink reviewable and caches inspected evidence only; old unavailable outcomes cannot suppress later valid evidence (lib/cleaning/backgroundRemnantInspection.ts:422,535).
- Candidate navigation marks page coordinates and chooses an overlapping existing region, while original/clean comparison remains local (components/cleaning/MaskEditor.tsx:470,1021; tests/cleaning/MaskEditor.test.tsx added comparison/navigation cases). No new mask authorization or automatic erasure is introduced.
- Page/export consumers assemble background evidence through getCurrentRemnantReview, so invalidated map entries cannot release output; artwork/background approval stays distinct from generated-text verification (src/app/page.tsx:1314; lib/export/reviewGate.ts:120,185; tests/cleaning/remnantReview.test.ts:362).

### Issues

#### Critical (Must Fix)

- None identified in the reviewed R01 changes.

#### Important (Should Fix)

- **Existing text evidence never reaches actual inspection.** hooks/useCleaning.ts:324 passes only result/source/confirmations into inspectCleanedPage. Its optional textEvidence input (lib/cleaning/remnantReview.ts:145,183) is not wired from the workspace's known source-text boxes, although the pure detector explicitly has a second pass for those areas (lib/cleaning/backgroundRemnantInspection.ts:452). A page with a successfully cleaned region and a surviving known source-text box elsewhere yields no candidates and can receive approved eligibility. Feed current nondeleted source-text evidence through the actual public seam, include its identity in review/cache invalidation, and add a hook/workspace fixture where the authorized region is clean but known text outside it remains. Keep that outside candidate observable in original/clean comparison without granting mask expansion; the current panel disables its only comparison/navigation action when there is no region (components/cleaning/RemnantReviewPanel.tsx:131).

#### Minor (Nice to Have)

- **Cache reuse still decodes both images.** lib/cleaning/remnantReview.ts:189-200 obtains both full luma planes before looking up the inspection cache. Repeated unchanged rechecks avoid detection but repeat image decode/canvas readback. Consider a revision-key cache lookup before decoding; test decoder call counts, since tests/cleaning/remnantReview.test.ts:277 checks result identity only.
- **Reported verification is noisy.** .superpowers/sdd/oct04-four-spec/R01-report.md:126 records unsupported jsdom canvas diagnostics in the older useCleaning suite. Configure that suite's decoder seam deliberately so expected unavailable evidence produces no environment-error noise; retain explicit decoder-failure tests.

### Assessment

- **Task quality: Needs fixes.** The production image binding and local restoration are conservative, but omitting existing text evidence creates an avoidable false approval outside removal bounds.
- **Checks:** Static diff review only; no git commands or tests rerun. The initial diff tool response truncated several hunks, so those incomplete hunks were read in bounded sections. No production files were separately reread to replace intact diff context.
- **Named outside check: provider calls on candidate opening.** Inspected only onResolveRegion references and the submission call context in components/cleaning/MaskEditor.tsx:756. Recovery runs on correction submission, not candidate opening; src/app/page.tsx:3096 itself only sets local focus/dialog state.
- **Named outside check: exact authorization binding.** Inspected lib/cleaning/textAuthorization.ts:3-5 to verify authorizationIdentity includes region id/rect, text confirmation, mask approval, approval revision and textRole. No broader crawl performed.
- **Reported validation:** R01-report.md:119,130 records 177 focused tests and a clean final TypeScript exit. These runs were not independently repeated; this review does not certify whole R02 or real-manga classifier accuracy.

### Fix review — base 0f3af12 / head 0f0c010

- **Spec compliance: ❌ One candidate-comparison gap remains; source-evidence omission is fixed.** Actual known source boxes now reach inspection and invalidate review/confirmation reuse, but candidates outside authorized removal regions still have no usable comparison/location navigation action (components/cleaning/RemnantReviewPanel.tsx:131-133). That is now a reachable case demonstrated by tests/cleaning/useCleaning.remnantReview.test.tsx:162.
- **Strength:** src/app/page.tsx:470 builds evidence from authoritative nondeleted original-text boxes, independent of render adjustment. The same expected live evidence is passed to output/publication and visible-panel accessors (src/app/page.tsx:1339,3135), so changed boxes fail closed before the setter effect runs.
- **Strength:** hooks/useCleaning.ts:276 compares expected/installed/bound evidence identity and rejects missing or wrong original context. hooks/useCleaning.ts:338 supplies source boxes/context; hooks/useCleaning.ts:344 rejects obsolete publication; hooks/useCleaning.ts:355 snapshots caller boxes and immediately invalidates bindings/tokens before scheduling local inspection.
- **Strength:** lib/cleaning/backgroundRemnantInspection.ts:66,174,337,533 includes exact source context and box IDs/coordinates in detector/cache revision keys. Artwork approval cannot cover changed evidence. The actual hook regression (tests/cleaning/useCleaning.remnantReview.test.tsx:162-212) asserts outside-region detection, immediate mismatch rejection, no decoding for equivalent setter input, new findings after changed evidence, and latest-evidence preservation when an obsolete decoder finishes.
- **Important — outside candidate comparison remains inaccessible:** components/cleaning/RemnantReviewPanel.tsx:131 disables the button without an overlapping removal region, and line 133 prevents invoking the navigation callback. The new outside-region fixture therefore exposes a finding whose exact location cannot be opened in original/clean comparison through the panel. Preserve disabled correction for unauthorized pixels, but supply a separate read-only comparison/focus action for this candidate; test its exact coordinates and absence of recovery/provider/removal calls. This is the remaining UI subpart of the original Important finding, not a request to expand masks or finish R02 history.
- **Task quality: Needs fixes.** Source-evidence binding and regression quality are approved; complete the remaining actual candidate comparison path before calling all R01 integration complete.
- **Minor carried forward:** unchanged explicit rechecks still decode before cache lookup (lib/cleaning/remnantReview.ts:192-203); equivalent evidence setter calls now correctly avoid that work (hooks/useCleaning.ts:357). Earlier jsdom diagnostic noise remains a documented suite limitation (R01-report.md:126).
- **Checks:** Read integration-fix-review.diff only, with bounded rereads of portions truncated by the tool response. No changed production files separately read, outside-code checks, git commands or tests run in this fix review. Updated R01 report's RED/GREEN, 58-test and lint/TypeScript results were read as reported validation, not independently repeated. G04 publication/strip changes were inspected for R01 accessor parity; their complete independent review belongs to G04.
- **Scope limitation:** R02 remains partial; actual whole-image/mask Undo/Redo and manual human confirmation of unavailable evidence are not certified by this review.

### Final comparison review — checkpoint 74e51a2

- **Spec compliance: ✅ R01 integration approved.** The remaining outside-mask comparison gap is resolved: components/cleaning/RemnantReviewPanel.tsx:130 supplies a comparison action independently of removal authorization, while the existing correction action remains disabled without an overlapping region (line 141). This approval incorporates the previously approved source-evidence correction; it supersedes the earlier R01 Important findings above.
- **Strength:** components/cleaning/RemnantReviewPanel.tsx:198-201 clips the original and clean assets to the same candidate.rect in page pixels using explicit source dimensions. This path contains image presentation only, with no provider, mask mutation, recovery, reinspection or confirmation invocation. src/app/page.tsx:3135-3138 supplies the current page original URL, cleaning result clean URL/dimensions and the already evidence-bound inspection accessor together.
- **Strength:** components/cleaning/RemnantReviewPanel.tsx:172 requires matching revision and both image URLs before presenting a crop. The dialog supports initial focus, Escape, Close and contained Tab navigation (lines 184-192); its trigger regains focus through closeComparison (line 70).
- **Strength:** tests/cleaning/RemnantReviewPanel.test.tsx:64 tests inside/outside authorization with exact image URLs, dimensions/offsets, absence of editing/confirmation callbacks and keyboard behavior. Line 97 tests confirmed-artwork comparison and hiding an obsolete revision. The report records RED followed by 9 passing panel tests and clean focused lint; root additionally reports a fresh 9-test pass. No optional test rerun was performed here.
- **Critical/Important:** None remain for R01 in the reviewed checkpoints.
- **Task quality: Approved.** Observation, known-source evidence binding, stale approval rejection and candidate comparison now satisfy the reviewed R01 integration scope while preserving existing removal boundaries.
- **Minor carried forward:** Explicit unchanged rechecks still decode before detector-cache lookup; older hook tests still have reported jsdom diagnostic noise. These do not invalidate the R01 behavior approval.
- **Checks:** Read R01-comparison-review.diff once and the final R01-report.md append. No extra production reads, outside-code checks, git commands, tests, index or commit operations; only this review report was edited.
- **Scope limitation:** R02 whole-image/mask Undo/Redo and unavailable-evidence human confirmation remain partial and unapproved. Synthetic heuristic evidence does not certify perfect source-text/artwork recognition or real-manga accuracy.
