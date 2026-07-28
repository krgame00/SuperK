# Aggressive All-Role Text Cleaning Design

- **Date:** 2026-07-28
- **Status:** Approved design; awaiting written-spec review
- **Target:** SuperK local web upload cleaning workflow
- **Selected policy:** Clean every detector region on every page role
- **Accepted trade-off:** UI text, credits, logos, and watermarks may be removed

## 1. Problem

The current pipeline detects most of the source text that remains visible after cleaning, but it intentionally preserves many detected regions. Two safety rules cause most of these false negatives:

1. Compact detected regions touching the outer 8% of a page enter the protection `review_mask`.
2. Regions with weak dialogue, narration, or SFX evidence receive `PRESERVE` with `LOW_CONFIDENCE`.

On the sampled original doujin pages, those regions commonly contain real dialogue, narration, and SFX. The conservative policy therefore leaves source text behind even though the detector located it correctly.

The first aggressive 20-page trial exposed a second blocker. Pages 4, 5, 7, and 8 in the approved English folder contained 33 detector regions but were classified as `UI`, so every region was preserved. Their current page features overlap with real UI benchmark pages; threshold tuning cannot separate them reliably.

## 2. Goal

Every text region produced by the detector must enter the automatic cleaning pipeline unless it intersects a hard-protected area. `COMIC`, `UI`, `CREDITS`, and `UNKNOWN` all use the same aggressive eligibility policy.

The feature increases recall deliberately. The user accepts that detector regions covering UI labels, credits, logos, watermarks, or decorative lettering may also be cleaned.

## 3. Non-goals

- Do not change text detection models, thresholds, or mask refinement.
- Do not add a new UI toggle, API field, or persisted cleaning mode.
- Do not weaken QR or user-authored `Protect` masks.
- Do not bypass cleaner verification or force a damaging repair into the final image.
- Do not guarantee removal of text that the detector does not detect.
- Do not preserve page pixels merely because page classification returns `UI`, `CREDITS`, or `UNKNOWN`.

## 4. Policy

### 4.1 Hard protection

A detected region must remain preserved when any of these conditions applies:

- The region intersects a QR protection mask.
- The region intersects a manual `Protect` mask supplied by the editor.

These conditions remain authoritative. Pixels covered by hard protection must remain identical to the original.

Page role, margin position, semantic role, and semantic confidence are not hard-protection conditions.

### 4.2 Aggressive all-role fallback

Every detected region that does not intersect hard protection receives `AutomaticAction.CLEAN`, regardless of page role.

The existing semantic classifier still labels the region as dialogue, narration, SFX, or review and still records its confidence and features. Those labels remain useful for diagnostics and the editor, but low semantic confidence no longer changes the automatic action to `PRESERVE`.

The page classifier and compact outer-margin heuristic may continue to annotate risk for diagnostics, but neither may put a detector region into a mask that prevents automatic cleaning.

### 4.3 Repair verification

`AutomaticAction.CLEAN` means the system must attempt the repair; it does not mean every attempted repair must be accepted.

The existing cleaner and verifier safety path remains in force:

1. Route and clean the detected region.
2. Check residual text, seams, boundary continuity, and collateral damage.
3. Perform the existing bounded retry when appropriate.
4. If verification still fails, restore the original pixels and return `NEEDS_REVIEW`.

This distinction prevents eligibility rules from silently skipping detected text while preserving the pipeline's ability to reject a visually damaging reconstruction.

## 5. Architecture and Responsibilities

The change remains inside existing component boundaries:

- `page_context.py` records whether the page resembles `COMIC`, `UI`, `CREDITS`, or `UNKNOWN`; this is diagnostic metadata only.
- `protection.py` produces QR hard-protection masks and optional risk annotations; page role does not create hard or review masks.
- `text_eligibility.py` assigns semantic metadata and the automatic action.
- `pipeline.py` attempts all `CLEAN` regions, applies verification, and restores rejected repairs.
- The editor's manual `Protect` workflow restores original pixels and remains the user recovery mechanism for false-positive logo or watermark removal.

No new endpoint or frontend state is required. Existing result schemas and region statuses remain compatible.

## 6. Data Flow

1. The detector produces pixel masks and grouped text regions.
2. Page classification records the page role for diagnostics.
3. Protection detects QR areas and combines them with manual `Protect` input.
4. Each region intersecting QR or manual hard protection remains preserved.
5. Every other detector region receives `CLEAN`, regardless of page role, margin position, or semantic confidence.
6. Semantic role and confidence are retained as diagnostics.
7. The router, cleaner, compositor, retry, and verifier process each eligible region normally.
8. Verified repairs enter the clean image; rejected repairs restore original pixels and become `NEEDS_REVIEW`.

## 7. Error Handling and Recovery

- Detector failure follows the existing page-level failure path; the aggressive policy cannot act without detected regions.
- Page-role uncertainty cannot suppress cleaning because page role is diagnostic only.
- Cleaner or verifier failure remains isolated to its region and does not fail the whole page.
- A false-positive UI, credit, logo, or watermark repair can be reversed by painting a manual `Protect` mask, which restores pixels from the original image.
- QR intersections remain hard-protected even when a detector region also contains ordinary text.

## 8. Benchmark Metrics

The benchmark must distinguish eligibility coverage from repair success.

### 8.1 New required metric

`unattempted_detected_region_count` counts detector regions on every page role that:

- do not intersect a hard-protection mask, and
- do not receive `AutomaticAction.CLEAN`.

The acceptance value is exactly `0`.

This metric detects regressions where page role, semantic confidence, or margin position silently prevents a repair attempt.

### 8.2 Existing safety metrics

The following gates remain unchanged:

- Changed pixels outside repair support: `0`
- Changed pixels inside protected masks: `0`
- Broad rectangular or colored patch regression: pass
- Visual review sheet: pass
- Runtime median target: at most 30 seconds per page after model warm-up

The prior `UI` and `CREDITS` pixel-identity gate is retired for this aggressive policy because those detector regions are now intentional cleaning targets. Visual review replaces identity as the quality gate for those pages.

`needs_review_rate` remains a reported outcome metric, not the aggressive eligibility gate, because verified repair failures may legitimately return `NEEDS_REVIEW`.

## 9. Test Strategy

### Unit tests

- A low-confidence interior region on each page role receives `CLEAN`.
- A compact region touching the outer margin receives `CLEAN`.
- Dialogue, narration, and SFX semantic labels and confidence remain available after the aggressive fallback.
- A region intersecting a QR mask remains preserved.
- A region intersecting a manual `Protect` mask remains preserved.
- Unprotected regions on `UI`, `CREDITS`, and `UNKNOWN` pages receive `CLEAN`.

### Pipeline tests

- Every unprotected detector region on every page role is sent to a cleaner.
- A verifier-rejected repair restores original pixels and returns `NEEDS_REVIEW`.
- A failed region does not prevent unrelated regions from completing.
- Manual `Protect` restores the original pixels after an aggressive false positive.

### Benchmark and visual tests

- The approved 20-page targeted trial reports `unattempted_detected_region_count = 0`.
- Protected-mask changes remain zero.
- Regenerate visual comparison sheets from pages 1–10 in each of the two user-approved folders.
- Inspect residual source text, removed UI/credits/logos/watermarks, bubble borders, artwork, and seams.
- Record new visual-review decisions only after examining the regenerated artifacts.

## 10. Acceptance Criteria

- Every detector region on every page role receives a cleaning attempt unless it intersects QR or manual hard protection.
- Page role, margin position, and low semantic confidence never cause an otherwise unprotected region to be preserved.
- `unattempted_detected_region_count` is `0` on the approved 20-page trial.
- Pages 4, 5, 7, and 8 in the approved English folder no longer preserve all detected text because of `UI` classification.
- Pixels inside QR and manual `Protect` masks remain unchanged.
- Verifier-rejected repairs restore original pixels and remain visible as `NEEDS_REVIEW`.
- Affected protection, eligibility, pipeline, and benchmark tests pass; frontend/build suites are not rerun because the contract and UI do not change.
- The approved 20-page performance and visual gates pass.
- The user reviews the regenerated visual comparison sheets before the implementation is considered accepted.

## 11. Expected Trade-offs

The expected benefit is substantially less detector-positive source text left behind, including on comic pages misclassified as UI or unknown.

The accepted cost is a higher false-positive rate for UI labels, credits, logos, watermarks, decorative lettering, and other detector-positive marks. QR hard protection and manual `Protect` provide recovery without reintroducing a page-role eligibility rule.
