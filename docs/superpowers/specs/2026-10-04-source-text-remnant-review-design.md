# Source-text remnant review

## Agreed intent

Detect original lettering left in cleaned backgrounds intended for translated output. This is independent of foreign-script contamination in generated text. The user approved reporting suspected locations for mask review and withholding translated export until corrected or explicitly confirmed to be artwork, without automatically deleting additional pixels.

## Verification and workflow

- Inspect the clean background before translated overlays are drawn; compare against original image/text evidence and existing removal regions. Do not run the remnant check on the composited translated image and mistake valid translated letters for remnants.
- Inspect updated clean backgrounds during processing and before export; associate findings with the exact original/clean background revision. Reuse completed checks for unchanged backgrounds. Never label an unperformed or failed check as clean.
- Show suspected remnant locations with original/clean comparison and an action to open the relevant mask region. Unknown candidates remain review findings; uncertainty never grants removal authorization.
- The user can correct the removal mask or explicitly confirm a candidate is artwork. Existing local mask bounds and removal-authorization rules remain binding. Confirmation applies only to the specific candidate and image revision, not the whole book or every future detector result.
- Recheck after background changes; retain confirmation only for unchanged candidate/image revisions. Missing originals, failed detection and unavailable verification require explicit human image inspection rather than silent approval.
- Opening old projects does not initiate provider requests, rewrite stored backgrounds or auto-clean pixels. Show stale/missing verification and offer explicit review. Existing image-level human confirmations cannot override detectable foreign letters in generated translation text.
- Continue processing subsequent pages while affected pages remain in the review list. Combined output eligibility requires both generated-text and background verification. Explicit original-image output or explicit page exclusion remain available, with page lists shown before export.

## Scope and dependencies

Depends on the target-identity and shared output-eligibility work in `2026-10-04-multilingual-translation-guard-design.md`. Do not report the full requested feature complete until this deliverable is integrated. This feature flags leftover source lettering; it does not authorize broader automatic cleaning or claim that every artwork-like text candidate can be classified perfectly.

## Acceptance

- Fixtures distinguish actual leftover lettering from hair, hatching, artwork and clean backgrounds. Partial glyph remnants remain eligible for a review finding.
- Tests inspect backgrounds without translated overlay; accepted Thai text in a composed preview does not create source-remnant findings.
- New/saved projects, mask changes, undo/redo and image-revision changes invalidate the correct findings/confirmations.
- Failures/missing evidence remain visible and require explicit review. Original export and explicit exclusion work without silently exporting an incomplete translation.
- Test workspace, cached/live/offscreen export and extension publication boundaries together with generated-text gates.
