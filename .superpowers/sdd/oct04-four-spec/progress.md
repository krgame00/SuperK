# Four-spec implementation progress

Baseline: 117dd367d269a0de7eb819ff597110cc6aaf5089
Branch: codex/translation-completeness
User authorized implementation via implement on 2026-10-04.

## Process

Use approved local tickets and their blockers. Fresh implementer per task; task-scoped review after each; broad final review and full suite once at the end. Preserve unrelated dirty files. No provider calls using real user manga. Do not update live runtime until current saved-work confirmation. Commit on current branch; no push requested.

## Task status

- P01: complete (117dd36..50010a2, spec compliant and quality approved); CPU/offscreen limits retained for G06
- P02: complete9d09b4b (review approved; see tail minors)
- S01: complete (50010a2..64b99f7; spec compliant and quality approved after fix); projectStore serialization root-verified
- S02: completeaf12f8c (review approved; see tail minors)
- S03: claimed renderer/hook preparation; page UI waits G04
- P03: pending (P02, S03)
- G01: complete (64b99f7..01101ee, spec compliant / quality approved after raw-inspection fix; 270 integration +111 fix tests/tsc)
- G02: complete77b2279 (review approved)
- G03: completee922b4b (fix review approved)
- G04: complete (9d09b4b..0f0c010, review approved after publication/strip fixes)
- G05: pending (G03)
- R01: pure complete0227c88; integration claimed existing dirtywork
- R02: pending (R01)
- R03: pending (G04, G05, R02)
- G06: pending (P03, R03)

## Review findings and constraints

- No preflight contradictions requiring user decisions found. Source-size work preserves width/corner contracts; strict text rejection and explicit human contextual/artwork verification are separate.
- Existing unrelated work: docs/AI-WORKING-NOTES.md, restore-whole-mask-region plan/design, master-doujin-consolidation plan and existing .superpowers contents. Stage only task-owned files.
- Current active tasks: S02 renderer and G02 review/repair integration in disjoint files. Do not repeat completed tasks after compaction; trust commits and this ledger.




- P01 minor review findings: p95 estimator differs from stated nearest-rank definition; diagnostic geometry totals include 60 harness reads per scene. Carry to final review; named comparison runner preserves original baseline.

P01 reviewer outside-diff check resolved by root: inspected production applyPointerMove width path and renderBubble; both invoke layoutBubbleAtFixedFont. Raw Chromium trace retained locally. No visible-user smoothness claim; G06 owns that acceptance.


User resumed implement 2026-10-04; prior agents no longer live. S01_resume continues existing files and actual-font browser failure. No completed work restarted. G01 pendingintegration; P02 inspectedplan awaits rendererownership.


G01_resume pureguard complete 94focusedtests+freshtsc; report G01-report.md. NativeHanIVS and failclosed Cn/Co/Cs/Cc integrated. Hook/overlay/pageintegrationstillpending; G01-brief.md captures durablehandoff.



S01 review rootcheck: projectStore bubble serializer spreads allmetadata then deletes runtime render only (sourceSizing retained). Async newawait lackedpost-cancellation/currentpages checks; fresh s01_review_fix taskedscoped guard andfocusedtests. Review must rerun afterfix.


P01 minor findings resolved inreport documentation: p95 actualceiling-index estimator namedaccurately, and 60harness observationreads explicitly excludedfrom pure-rendererattribution. Measurementsunchanged; no rerunneeded. Stage reportwithnextdocumentcommit.


S01 fix committed64b99f7 (d106a2a..64b99f7); catchinvalidates matchedfallback andderivedsize, newawait scopedownershipguards. 13focusedtests+tsc passed, hooklintfourpreexistingwarnings. Re-reviewpending beforeS01resolved/G01integration.



Parallel skill applied: G01 owns hook/overlay/page/policy/store/UI; S02 owns pure source modules/new evidence tests only. No sharedfilewrites; S02interfaces optionalcompatibility androotapprovalbeforeedits. Rootserialized commits.



G01 review Important rawtrim bypass; fix agent owns overlay and qualityReview parser plus tests. S02 renderer remains waiting. Root named related suggestion-trim risk added to same fix scope.


G01 finalreview approved01101ee; rawtrim Important resolved. G01 minor existinglintnoise retained for finaltriage. Parallelskill: S02 exclusively renderer/source modules; G02 hooks/quality/API only; shared interfaces optional and crossfile changes root-coordinated; commits serialized.

R01 claimed pure/new evidence slice only; newlib/tests no hook/page edits while G02/S02 own them. Full R01 requires later actual workspace integration/review.

G02: implementer DONE + review Approved (spec ✅, no Critical/Important). Minors for final triage: policyVersion bound into snapshots but isReviewCurrent does not consume it (hand to G03/G04 or wire one line); scriptGuard rewrite dropped 3 regression tests for unchanged hook exports; empty-t reason text says over-limit (qualityReviewClient.ts:39); once-per-run repair enforced by construction only; String(getPageRevision) can stringify "undefined" (fail-closed); report test-count off by one. G02 implementer saw page.tsx:2683 TypeError in workflow tests verified unrelated to G02 (suspect S02 in-flight overlay) — recheck after S02 lands. Committing G02 owned paths only.

Workflow-mock fix: tests/workflow/WorkspacePage.test.tsx translationMockState gained the 17 hook fields page.tsx consumes since G01 (pageTargetCacheRef, getPageTargetLanguage, glossary/save/retry/failureGroups/autoProceedOnReview/replaceBubbleText/cacheRevision etc.); workflow 74/74 green (was 47 failing on page.tsx:2683 TypeError). G02's unrelated-failure concern resolved.

S02: integration DONE + review Approved (spec ✅ all binding constraints, no Critical/Important). Minors for final triage: overflow block center-anchored clips first/last lines (translationOverlay.ts:1265 — follow-up ticket candidate: top-anchor when overflow); preparation exclusions/contextKey do not filter deleted bubbles (sourceTextSizeClient.ts:70, conservative self-healing); rotated long-text border-whiteness fails closed (sourceTextSize.ts:74); reopen-at-0.44 assertion compares zoom-invariant quantities; neighbor blindness residual ~2-3px clearance. Committed S02 owned paths (pure slice + renderer integration + browser fixture).

R01: pure slice DONE_WITH_CONCERNS (20/20 focused, tsc/eslint clean, new files only: lib/cleaning/backgroundRemnantInspection.ts + its test). Concerns are recorded design limits (luma heuristic blind spots; clean-vs-preview responsibility on the future hook; revision-identity cache trust) — sent to task review; integration interface proposal in R01-report.md awaits root lock for later workspace integration.

R01: pure slice review Approved (spec ✅, no Critical/Important; eligibility mapping verified against real pageEligibility boundary). Minors carried for the integration task: skip caching unverified inspection results (backgroundRemnantInspection.ts:526); pass-2 survivingRatio threshold hardcoded (line 465); invalidate() lacks a test; lumaPlaneFromRgba silently pads short RGBA buffers (line 172). Committing the two new files; R01 full completion still awaits workspace integration lock (folded into later R-wave planning).

G03: implementer DONE + review Approved (spec ✅; cancellation/single-undo/non-dismissibility verified; policyVersion wired into isReviewCurrent per G02 carry). One Important: postponed legacy confirm is a dead end (no affordance after "ยืนยันภายหลัง"; repair toast drops summary.skipped) — fixer dispatched (plus adjacent minors: hardcoded "ภาษาไทย" label vs targetLangRef, unhandled rejection on handleRepairWholeBook). Re-review of the fix before commit. Minors to final triage: evidence-only repair round has no undo entry; two useState jammed on one line (~744); same-point post-repair edit clobbered by undo (coarse undo, spec-met); G04 must not pass sourceRevision naively into isReviewCurrent (markPageDirty bumps page revision); extension-handoff legacy path untested.

G03 fix re-review: Fix approved (postpone affordance reachable from scan + review paths; skipped surfaced; label follows target; catch toasts failures). Residual cosmetic minor: cancelled-branch repair toast omits skipped note (page.tsx:716). Committing G03 owned paths; page.tsx ownership released for G04.

P02: DONE + review Approved (spec ✅; zero drag-time canvas work verified at three seams; exactly-once commit; snapshot identity invalidation spares move/rotate; matched-auto excluded before snapshot use; browser p02 run clean). Minors to final triage: measureTextSelection computed then discarded on snapshot renders (lazy ternary); scaleDragSnapshot not cleared in no-op early return; width-edit invalidation lacks a direct test assertion (P03 builds on this seam — close it there); duplicated matched-auto condition cosmetic. Committed P02 owned paths.

Resume latestHEAD9d09b4b after interruption: all prioragents absent. Three disjointowners S03renderer/hook, G04page/export, R01cleaning/store/UI. No finishedticket repeated; R01pureonly fullintegrationpending. UncommittedCONTEXT attributionpending preserve.

Resume clarification: CONTEXT.md dirty archival/takeout/collection terms are unrelated to this task, preserve and neverstage. HEAD9d09b4b current; G04/R01/S03 new agents resume, productionunchanged.
Resume concrete risks under active owners: G04 must inspect control-only raw points rather than trim-filter and use persistedpolicy; S03/G04 stable originalsource fingerprint replaces editrevision (optionalmap/preparedfield, persistedexistingcleaningmetadata). R01 localrestore must not provider-fetch missing assets; decoder shortbuffer tests and same-size sourcefingerprint evidence. R01 preserved/protected cleaningregions are authorization states, not source-text/artwork approval; knownletters need candidate confirmation. G03 manual-noOCR sourceimage confirmation recovery proposed S03/G04, stillpending; explicitimagecrop sourceidentity rather than genericpageapprove. All are actualrequirements, no userdecisionneeded.
G06 build preparation decision: validated installed Next16.3 distDir/output docs. next.config PWA writes public/sw.js and standalone .next, so do not run productionbuild in livecheckout before current savedworkconfirmation. After allfeaturecommits/reviews, create fresh .scratch verification source copy/archiveHEAD, node_modules junction to repo, build there withdirectlocalNode, isolatedportbrowserhealth; noenvironment/providerkeys copied. Then current savedworkconfirmation finalruntime update. No suchbuildyet.
G04 exactpixelrisk: raw livecanvas/cachedraster cannot be stampedwithcurrent signature atoutput; unprovenones fresh offscreenaftergate SINGLE+bulk, recheckinputsignature+eligibilityafterawait, abort onmutation. S03 optional producedcache signaturecapture runtimeowner. R01 MaskEditor race actualnavigation test flaky; ownerfixingunderdebugdiscipline, R02 fullimageUndo stillpendingfreshowner.

R01integrationready177focusedtests+tsc/lint; S03CORE47focusedtests+tsc/lint UIpending; G04ready29focusedtests+tsc/lint, root34cross-contracttests+tscgreen. RootnormalizedloneCRpage causingwholesaleGitdiff; no semanticchange. G04newtestactwarningscleanup pending. Coherentcheckpointcommit willinclude3optionalAPI integratedowners beforeR01/G04review; S03fullreview afterUI. G05claimed independentextensionfiles/routes, no sharedpage/hook changes.

Coherentintegrationcheckpoint0f3af12 combines verified R01/G04 and S03CORE optionalcontracts so HEADbuildable. Roottsc0 and34cross-contracttests passed, G04then29cleanedtests. R01/G04 scopedreviews now; S03notcomplete UIpending. Minor gitdiffcheck detected1newblanklineEOF in translationOverlayCornerDrag.test.ts, fixinS03final. Fullsuite/livebuild notrun.
0f3af12 taskreviews: G04 Important publication cache-vs-active payload mismatch and multipartstrip partialrelease; freshg04_output_fix ownspage/gate/test, rootapproves multipartstrip singleZIP transactionalrelease (singlePNGunchanged). G05publication new payload identityfields needed. R01 Important actualhook omitsoptionaltextEvidence outside removalregions; freshfix willwire sourcebox evidence+exactrevision/cache invalidation and actualhooktest, pagebinding coordinatedG04owner. S03pageUIremainpending untilbothfixreviews approved. Reports G04-review.md/R01-integration-review.md retainlineevidence.

R01/G04 fixes rootfresh5files91tests passed13.34s, clean exceptexistingNode experimentalstoragewarning. Commitfixcheckpoint created; re-reviewbothgates beforeS03pageUI.

R03 root integration: full revision-bound background proof now gates extension render/cache/publish paths; publish-back verifies clean image SHA-256; workspace persists the reader image URL separately from the recoverable data-URL source. 9 focused files/77 tests + fresh TypeScript passed. Contract extracted to small shared module to avoid embedding detector in extension policy. R03 report records local-pixel inspection trust limit; G06 browser/build verification remains pending. Do not stage unrelated archival/doc dirt.

R02 root review: actual hook undo/redo restores immutable clean/mask assets, regenerates URLs and local review state without provider calls; stale page/session/source/evidence is guarded. Whole-image acknowledgement is separate, exact-revision, image-load-gated, persisted and unavailable when source pixels are missing. Panel's source-box compare stays read-only. 3 files/27 mask/store tests passed; R02 report added. Combined current selection now passes 34 files/311 tests with maxWorkers=1, TypeScript clean. G06 remains the single full-suite/build/browser gate.

G05 root review complete: generated extension bundle rebuilt from shared policy; altered display snapshots and invalid/missing background proofs fail closed; API binds clean bytes to exact background revision. Reader target URL now survives workspace data-URL source restoration. Legacy visual fixtures were separated from strict policy tests; direct extension route tests now assert editor handoff. Updated extension UI/sync/API tests pass in the 34-file/311-test selection. See G05-report.md.

R01 final review was already Approved at 74e51a2; status changed from claimed to implemented. S03 actual toolbar controls and persisted extension reader identity are integrated; S03 report updated. P03 remains DONE_WITH_CONCERNS due software-raster benchmark limitations already recorded in P03-report.md. G06 is the only remaining ticket before final full suite, isolated build/browser check and consolidated commit.

G06 resumed 2026-10-04: `tsc` and six focused files/70 tests pass. WorkspacePage integration still has 15 failing assertions, partly stale renderer expectations and duplicate responsive menu roles in jsdom; see G06-report.md. Isolated webpack compilation reached generated route-type validation, which rejects existing test helper exports from route modules. Earlier accidental root build removed production `.next` files; localhost:3000 returned 200, and incomplete scratch output was deliberately not copied. No restart/push/commit. G06 remains incomplete.

Correction checkpointfixcommit initialblockedbyextraEOFblankline, rootremovedonlyextraEOF lineandstagedcheckpassed; commit nowexists, usegitlognextline.

G04 finalreviewapproved0f0c010. R01 re-review sourceevidencefixapproved BUT outside-region candidate onlynavigationdisabled =>remainingImportant; r01_comparison_fix narrowpanel+pageprops read-onlycrop UI. R01notresolved yet. G05core/sourcehash correctionready43tests; workspacehandoffidentity restoration notwired, tasknotcomplete. S03UI/missingOCR originalimageconfirmation awaitsR01pagefreeze; P03/R02 stillblocked. Reviewer minorwarnings carriedfinal.
