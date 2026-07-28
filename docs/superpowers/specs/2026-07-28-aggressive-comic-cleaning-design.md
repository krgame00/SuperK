# Aggressive Comic Text Cleaning Design

- **Date:** 2026-07-28
- **Status:** Approved design; awaiting written-spec review
- **Target:** SuperK local web upload cleaning workflow
- **Selected policy:** Clean every detector region on confirmed comic pages
- **Accepted trade-off:** Logos and watermarks inside comic pages may be removed

## 1. Problem

The current pipeline detects most of the source text that remains visible after cleaning, but it intentionally preserves many detected regions. Two safety rules cause most of these false negatives:

1. Compact detected regions touching the outer 8% of a page enter the protection `review_mask`.
2. Regions with weak dialogue, narration, or SFX evidence receive `PRESERVE` with `LOW_CONFIDENCE`.

On the sampled original doujin pages, those regions commonly contain real dialogue, narration, and SFX. The conservative policy therefore leaves source text behind even though the detector located it correctly.

## 2. Goal

On a page classified as `COMIC`, every text region produced by the detector must enter the automatic cleaning pipeline unless it intersects a hard-protected area.

The feature increases recall deliberately. The user accepts that a detector region covering a logo or watermark inside a comic page may also be cleaned.

## 3. Non-goals

- Do not change text detection models, thresholds, or mask refinement.
- Do not add a new UI toggle, API field, or persisted cleaning mode.
- Do not weaken QR or user-authored `Protect` masks.
- Do not clean detected text automatically on `UI`, `CREDITS`, or `UNKNOWN` pages.
- Do not bypass cleaner verification or force a damaging repair into the final image.
- Do not guarantee removal of text that the detector does not detect.

## 4. Policy

### 4.1 Hard protection

A detected region must remain preserved when any of these conditions applies:

- The page role is `UI`.
- The page role is `CREDITS`.
- The page role is `UNKNOWN`.
- The region intersects a QR protection mask.
- The region intersects a manual `Protect` mask supplied by the editor.

These conditions remain authoritative. Pixels covered by hard protection must remain identical to the original.

### 4.2 Aggressive comic fallback

For a confirmed `COMIC` page, a detected region that does not intersect hard protection receives `AutomaticAction.CLEAN`.

The existing semantic classifier still labels the region as dialogue, narration, SFX, or review and still records its confidence and features. Those labels remain useful for diagnostics and the editor, but low semantic confidence no longer changes the automatic action to `PRESERVE`.

The compact outer-margin heuristic is no longer a blocking protection rule for confirmed comic pages. It may continue to annotate a region as a margin-risk diagnostic, but it must not put that region into a mask that prevents automatic cleaning.

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

- `page_context.py` decides whether the page is `COMIC`, `UI`, `CREDITS`, or `UNKNOWN`.
- `protection.py` produces hard-protection masks and optional risk annotations.
- `text_eligibility.py` assigns semantic metadata and the automatic action.
- `pipeline.py` attempts all `CLEAN` regions, applies verification, and restores rejected repairs.
- The editor's manual `Protect` workflow restores original pixels and remains the user recovery mechanism for false-positive logo or watermark removal.

No new endpoint or frontend state is required. Existing result schemas and region statuses remain compatible.

## 6. Data Flow

1. The detector produces pixel masks and grouped text regions.
2. Page classification determines the page role.
3. Protection detects QR areas and combines them with manual `Protect` input.
4. On non-comic pages, detected regions remain preserved under the existing page policy.
5. On comic pages, each region intersecting hard protection remains preserved.
6. Every other comic region receives `CLEAN`, regardless of margin position or semantic confidence.
7. Semantic role and confidence are retained as diagnostics.
8. The router, cleaner, compositor, retry, and verifier process each eligible region normally.
9. Verified repairs enter the clean image; rejected repairs restore original pixels and become `NEEDS_REVIEW`.

## 7. Error Handling and Recovery

- Detector failure follows the existing page-level failure path; the aggressive policy cannot act without detected regions.
- Page-role uncertainty remains safe because `UNKNOWN` pages are not aggressively cleaned.
- Cleaner or verifier failure remains isolated to its region and does not fail the whole page.
- A false-positive logo or watermark repair can be reversed by painting a manual `Protect` mask, which restores pixels from the original image.
- QR intersections remain hard-protected even when a detector region also contains ordinary text.

## 8. Benchmark Metrics

The benchmark must distinguish eligibility coverage from repair success.

### 8.1 New required metric

`comic_unattempted_detected_region_count` counts detector regions on `COMIC` pages that:

- do not intersect a hard-protection mask, and
- do not receive `AutomaticAction.CLEAN`.

The acceptance value is exactly `0`.

This metric detects regressions where semantic confidence or margin position silently prevents a repair attempt.

### 8.2 Existing safety metrics

The following gates remain unchanged:

- Changed pixels outside repair support: `0`
- Changed pixels inside protected masks: `0`
- `UI` and `CREDITS` identity checks: pass
- Broad rectangular or colored patch regression: pass
- Visual review sheet: pass
- Runtime median target: at most 30 seconds per page after model warm-up

`needs_review_rate` remains a reported outcome metric, not the aggressive eligibility gate, because verified repair failures may legitimately return `NEEDS_REVIEW`.

## 9. Test Strategy

### Unit tests

- A low-confidence interior region on a `COMIC` page receives `CLEAN`.
- A compact region touching the outer margin on a `COMIC` page receives `CLEAN`.
- Dialogue, narration, and SFX semantic labels and confidence remain available after the aggressive fallback.
- A region intersecting a QR mask remains preserved.
- A region intersecting a manual `Protect` mask remains preserved.
- Regions on `UI`, `CREDITS`, and `UNKNOWN` pages remain preserved.

### Pipeline tests

- Every unprotected detector region on a comic page is sent to a cleaner.
- A verifier-rejected repair restores original pixels and returns `NEEDS_REVIEW`.
- A failed region does not prevent unrelated regions from completing.
- Manual `Protect` restores the original pixels after an aggressive false positive.

### Benchmark and visual tests

- The 30-page benchmark reports `comic_unattempted_detected_region_count = 0`.
- Protected-mask and page-identity gates remain at zero changes.
- Regenerate visual comparison sheets from the original doujin corpus.
- Inspect residual Japanese text, removed logos or watermarks, bubble borders, artwork, and seams.
- Record new visual-review decisions only after examining the regenerated artifacts.

## 10. Acceptance Criteria

- Every detector region on a confirmed `COMIC` page receives a cleaning attempt unless it intersects QR or manual hard protection.
- Margin position and low semantic confidence never cause an otherwise unprotected comic region to be preserved.
- `comic_unattempted_detected_region_count` is `0` on the benchmark.
- `UI`, `CREDITS`, and `UNKNOWN` pages retain the existing preserve behavior.
- Pixels inside QR and manual `Protect` masks remain unchanged.
- Verifier-rejected repairs restore original pixels and remain visible as `NEEDS_REVIEW`.
- All existing unit, integration, frontend, type-check, build, performance, and visual regression gates pass.
- The user reviews the regenerated visual comparison sheets before the implementation is considered accepted.

## 11. Expected Trade-offs

The expected benefit is substantially less source text left behind on comic pages, especially at page edges and in stylized SFX.

The accepted cost is a higher false-positive rate for logos, watermarks, decorative lettering, and other detector-positive marks inside comic pages. Hard protection and manual `Protect` provide recovery without reintroducing a conservative global eligibility rule.
