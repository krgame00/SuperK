# Preserve artwork through text detection, review, and export

Status: completed
Target triage: ready-for-agent
Date: 2026-09-14

## Problem Statement

The workspace can mistake character artwork for text and authorize its removal. A review warning does not reliably prevent this: some eligibility decisions label a region for review while still permitting cleaning. The user needs artwork preserved when text evidence is uncertain, without stopping useful work on confident regions or discarding legitimate short and decorative text.

A synthetic detector experiment reproduced a specific admission boundary: an identical sparse stroke was rejected at a stubbed block confidence of 0.59, but admitted at 0.60 and 0.90, producing 164 nonzero mask pixels. This establishes detector behavior under controlled input; it does not establish the real model's output on the supplied screenshots or prove downstream pixel damage in that case.

## Solution

Keep an Unconfirmed text candidate available for inspection while preserving its original artwork and excluding it from automatic removal and translation. Continue processing confident regions on the same page. Support sound effects, decorative lettering, and isolated glyphs rather than rejecting those categories.

For a reviewed candidate, separate Text confirmation from Removal-mask approval. Let the user inspect and adjust the proposed removal pixels before authorizing cleaning. Explicit export confirmation accepts the current image and translation revision, including deliberately preserved regions; it never starts additional cleaning. Dismissing a warning does not confirm a page.

## User Stories

1. As a reader, I want uncertain character lines preserved, so that translation does not damage the artwork.
2. As an editor, I want Unconfirmed text candidates retained for inspection, so that difficult text is not silently lost.
3. As an editor, I want uncertain candidates excluded from automatic removal, so that a suspected detection cannot erase artwork.
4. As an editor, I want uncertain candidates excluded from translation, so that artwork is not turned into invented dialogue.
5. As a reader, I want confident regions processed on a partially uncertain page, so that one ambiguous mark does not stop useful work.
6. As a batch user, I want unrelated pages to continue, so that local review work does not discard other results.
7. As an editor, I want isolated real glyphs supported, so that short text is not rejected merely for resembling a line.
8. As an editor, I want sound effects supported, so that decorative content remains available for translation.
9. As an editor, I want outlined and colored lettering supported, so that artwork protection does not exclude common lettering styles.
10. As an editor, I want text touching artwork to remain reviewable, so that ambiguity is handled explicitly.
11. As a reviewer, I want to confirm that a candidate contains text without changing the image, so that recognition and deletion are separate decisions.
12. As a reviewer, I want to see the proposed removal mask on the source image, so that I can inspect the exact pixels at risk.
13. As a reviewer, I want to correct that mask before approving it, so that nearby character lines remain intact.
14. As a reviewer, I want cleaning confined to the approved mask, so that approval cannot authorize a larger repair later.
15. As an editor, I want retries and residual-text handling to respect the same authorization, so that a later pass cannot undo my protection decisions.
16. As a returning user, I want restored projects to retain review decisions, so that reopening does not silently authorize uncertain content.
17. As a reader, I want to explicitly export the current page with uncertain regions preserved, so that I can accept useful partial results.
18. As a reader, I want export confirmation to leave the image unchanged, so that the exported content matches what I reviewed.
19. As a reader, I want closing a warning to leave its review requirement intact, so that dismissal is not mistaken for consent.
20. As a reviewer, I want image or translation changes to invalidate export acceptance, so that acceptance refers to the revision I actually inspected.

## Implementation Decisions

- Separate detection evidence, text identity, removal authorization, and page export acceptance. A bounding box, a detector score, or a review label alone does not authorize uncertain removal.
- Update detector evidence handling, cleaning eligibility and orchestration, service/client result contracts, translation selection, review controls, project restoration, and export confirmation as one coherent behavioral change.
- Preserve original model confidence separately from confidence-like values assigned to constructed masks. Stroke expansion is not independent evidence that text exists.
- Do not solve the problem by blindly changing the detector's Boolean condition or raising a global threshold. Calibrate ambiguous artwork handling against both text-positive and artwork-negative examples.
- Retain uncertain candidates and their proposed masks separately from the authorized Text-removal mask. Never use the proposal as implicit cleaning permission.
- Represent candidate review and mask approval explicitly enough that an unconfirmed candidate cannot be automatically cleaned. Exact field names and enum changes are engineering choices; the service and client must share their meaning.
- Text confirmation is necessary before translating a reviewed candidate. It does not approve its mask, alter the source image, or automatically trigger a request. Removal-mask approval authorizes only the inspected region revision.
- Exclude unconfirmed candidates from the automatic translation work set and rendered results. A translation response must not reintroduce excluded regions. The implementation must account for existing page-image translation rather than relying solely on a UI flag.
- Process confident regions on partially uncertain pages. Distinguish regional text uncertainty from a page whose preparation failed quality verification; retain the existing bounded recovery and page-failure behavior for the latter.
- Cleaning, manual retry, adaptive cleaning scope, residual expansion, and cached/prepared result reuse must all enforce the same authorized mask. Cleaner context may be larger than the writable mask; final compositing must preserve pixels outside it.
- Bind manual mask approval to the inspected source and mask revision. Changed proposals require fresh approval. Existing prepared-page identity and policy revision handling must prevent older permissive results from bypassing the new boundary.
- Restore existing projects conservatively: missing approval metadata is not approval. Retain editable assets and user work; do not claim to restore already damaged imagery merely by changing a status.
- Keep export acceptance separate from region approval. Explicit acceptance may export the existing preserved page, but may not clean, translate, approve masks, or clear candidate decisions. Warning dismissal only dismisses the presentation.
- Preserve existing confirmed-page revision invalidation after image or text changes, and existing bounded batch scheduling.

## Testing Decisions

Testing seams below await the user's confirmation before this spec is marked ready-for-agent.

- Prefer externally observable behavior over private helper calls, enum layout, or exact threshold constants. Assert output pixels, returned review information, selected translation work, user-visible state, and whether external work was invoked.
- Use the existing public CleaningPipeline entry points as the primary service seam, including normal and adaptive runs and reviewed-region actions. Existing pipeline and adaptive-pipeline tests already inject detectors and cleaners; use those facilities for deterministic artwork/text mixtures without requiring model downloads.
- Use the existing workspace translation hook and review/export interaction harnesses as the application seam. Existing translation hook tests exercise request calls, cancellation, restoration, and cache behavior; existing mask-editor and export tests provide interaction and rendering prior art. Exercise the real warning-confirmation handlers, since export-button callback tests alone cannot catch dismissal granting acceptance.
- Use shared fixture scenarios across these two runtime boundaries. Avoid creating a separate test seam for every internal module. Retain the detector-level sparse-stroke reproduction only as a focused diagnostic regression alongside the higher-level behavior tests.
- Acceptance matrix: (a) artwork-only ambiguous candidate produces review information, no authorized removal and no translation work; (b) confident text plus an uncertain candidate processes only the confident region; (c) confirming text alone leaves pixels unchanged; (d) approved mask cleaning changes no pixel outside that mask; (e) retry, residual processing and restored/prepared results cannot promote unconfirmed candidates; (f) isolated glyphs, SFX and outlined colored text remain detectable or reviewable rather than categorically discarded; (g) warning dismissal does not unlock export; (h) explicit export acceptance uses existing assets without cleaning or translation; (i) editing the reviewed revision requires fresh export acceptance.
- Test translation eligibility at request selection and response integration, including a response containing an excluded candidate. Verify confidently processed regions survive mixed-page review and restoration.
- Use deterministic synthetic fixtures for the authorization contract and representative annotated images for detector calibration. Report artwork damage and legitimate-text recall separately; do not infer a real-model accuracy improvement from stubbed scores.
- Keep model-dependent replay separate from fast contract tests. Exact screenshot-case validation remains unavailable until the original input or captured detector output can be linked reliably. This limitation must remain explicit in implementation validation.

## Out of Scope

- Replacing or retraining OCR, detection, or inpainting models as a prerequisite.
- Guaranteeing perfect character/text classification or declaring a confirmed root cause for the supplied screenshot run.
- Automatically repairing damage in previously cleaned assets without the necessary original data.
- Changing translated typography, export destinations, cloud concurrency, or introducing user-facing numeric detector tuning.
- Blanket rejection of isolated glyphs, decorative text, or sound effects.
- Making all pages wait for manual approval, or overriding existing page-level quality-failure handling.
- Creating implementation tickets or applying production code changes as part of this spec-writing task.

## Further Notes

The behavioral policy was accepted in two interview rounds: preserve uncertain candidates while continuing confident work; separate inspectable candidates from authorized removal/translation; retain short and decorative text; separate Text confirmation from Removal-mask approval; and allow explicit preserved-state export without treating dismissal as acceptance.

Use the existing domain glossary terms: Unconfirmed text candidate, Region awaiting text confirmation, Text confirmation, Removal-mask approval, Text-removal mask, Confirmed page revision, and Prepared-page identity.

Respect the accepted local-project recovery/review decision and bounded-prefetch/adaptive-cleaning decision. Regional text review must not weaken their revision identity, retained editability, authorized-mask, or page-quality guarantees.

The project issue tracker is local Markdown. This draft is stored there; promotion to ready-for-agent awaits the testing-seam check required by the invoked to-spec skill. No further product interview is required.
