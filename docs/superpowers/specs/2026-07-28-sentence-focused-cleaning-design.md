# Sentence-Focused Text Cleaning Design

- **Date:** 2026-07-28
- **Status:** Approved design; awaiting written-spec review
- **Target:** SuperK local web upload cleaning workflow
- **Selected policy:** Clean dialogue, narration, and review regions; preserve high-confidence SFX
- **Performance target:** Median at most 30 seconds per page on the approved CPU workflow

## 1. Problem

The all-role aggressive pipeline now attempts every unprotected detector region. This removes dialogue and narration reliably, but it also removes sound effects that the user does not need translated.

Expanding detector recall with tiled or contrast-normalized passes would spend additional CPU time mainly to find more stylized SFX. That work no longer serves the user's goal. The cleaner should focus on sentences and prose while leaving confident visual sound effects in the artwork.

## 2. Goal

Use the existing single-pass CTD detector and semantic eligibility features to:

- clean `DIALOGUE`,
- clean `NARRATION`,
- clean ambiguous `REVIEW` regions to retain aggressive sentence recall,
- preserve high-confidence `SFX`,
- preserve QR and manual `Protect` masks,
- keep page role diagnostic-only.

## 3. Non-goals

- Do not add multi-scale, tiled, contrast-normalized, or secondary detection.
- Do not add OCR or a second model to interpret text content.
- Do not change CTD model weights, detector thresholds, mask refinement, cleaner routing, or verifier thresholds.
- Do not restore page-role protection for `UI`, `CREDITS`, or `UNKNOWN`.
- Do not guarantee preservation of low-confidence SFX; uncertain regions remain `REVIEW` and are cleaned.
- Do not add a frontend toggle, API field, or persisted mode.

## 4. Eligibility Policy

Eligibility runs after page classification and hard-protection detection.

### 4.1 Hard protection

A region receives `AutomaticAction.PRESERVE` when it intersects:

- a QR protection mask, or
- a manual `Protect` mask.

Hard protection takes precedence over every semantic role. Protected pixels remain identical to the original.

### 4.2 Cleanable roles

The following roles receive `AutomaticAction.CLEAN` on every page role:

- `DIALOGUE`
- `NARRATION`
- `REVIEW`

`REVIEW` includes low-confidence or semantically ambiguous detector regions. Cleaning it preserves the recall gained by the previous aggressive policy and avoids reintroducing the original problem where sentences without clear bubbles were silently skipped.

### 4.3 Preserved SFX

A region classified as `TextRole.SFX` at or above the existing `SFX_THRESHOLD = 0.90` receives `AutomaticAction.PRESERVE`.

Its region record keeps:

- `text_role = SFX`
- the calculated eligibility confidence
- `automatic_action = PRESERVE`
- `protection_reasons = [ProtectionReason.SFX_POLICY]`

No new confidence threshold is introduced. A possible SFX below 0.90 remains `REVIEW` and is cleaned.

## 5. Architecture and Data Flow

The existing component boundaries remain:

1. `detector.py` runs CTD once and returns blocks plus a probability mask.
2. `mask_refiner.py` creates pixel masks and repair regions.
3. `page_context.py` records page role for diagnostics only.
4. `protection.py` creates QR hard-protection masks.
5. `text_eligibility.py` assigns dialogue, narration, SFX, or review and applies the sentence-focused action policy.
6. `pipeline.py` sends only `CLEAN` regions through routing, cleaning, composition, retry, and verification.
7. Verified repairs enter the clean image.
8. Verifier-rejected repairs restore original pixels and return `NEEDS_REVIEW`.
9. Policy-preserved SFX remains `PRESERVED`, not `NEEDS_REVIEW`.

Add `ProtectionReason.SFX_POLICY = "sfx-policy"` to the existing enum. This adds a backward-compatible enum value inside the existing metadata list; it does not add an endpoint field or frontend state.

## 6. Metrics

The benchmark must distinguish three outcomes:

- attempted sentence/prose regions,
- intentionally preserved SFX or hard-protected regions,
- policy violations where another unprotected role was not attempted.

Replace the generic unattempted gate with:

`unexpected_unattempted_region_count`

It counts a preserved detector region when all conditions are true:

- it does not intersect a hard-protection mask,
- its semantic role is not `SFX`, and
- it did not receive `AutomaticAction.CLEAN`.

Acceptance requires `unexpected_unattempted_region_count = 0`.

Report policy-preserved SFX separately as:

`preserved_sfx_region_count`

Verifier failures remain in `needs_review_count` and do not count as eligibility policy violations because their original action was `CLEAN`.

## 7. Test Strategy

### Unit tests

- High-confidence SFX at 0.90 receives `PRESERVE` with `TextRole.SFX` and `SFX_POLICY`.
- SFX evidence at 0.899 receives `CLEAN` with `TextRole.REVIEW`.
- Dialogue receives `CLEAN`.
- Narration receives `CLEAN`.
- Low-confidence fallback review receives `CLEAN`.
- The same policy applies on `COMIC`, `UI`, `CREDITS`, and `UNKNOWN`.
- QR intersection overrides SFX and cleanable roles with hard protection.

### Pipeline tests

- A policy-preserved SFX region is not sent to a cleaner and remains `PRESERVED`.
- A verifier-rejected dialogue/narration/review repair restores original pixels and becomes `NEEDS_REVIEW`.
- Manual `Protect` continues restoring source pixels.

### Targeted benchmark

Use exactly these ten pages:

- `F:\Doujin\Download\CieloBivolta\01.webp` through `05.webp`
- `E:\โด\nhentai-656214 - [JIMPU6] Finish SW999&Fugue (Honkai- Star Rail)\1.webp` through `5.webp`

Do not use `CieloBivolta` files whose names contain `(1)`.

Regenerate visual artifacts and inspect:

- dialogue and narration removal,
- preservation of high-confidence SFX,
- ambiguous review-region behavior,
- bubble and panel borders,
- broad patches, seams, and artwork damage.

## 8. Acceptance Criteria

- `DIALOGUE`, `NARRATION`, and `REVIEW` receive cleaning attempts across every page role.
- High-confidence `SFX` receives `PRESERVE`.
- QR and manual `Protect` pixels remain unchanged.
- `unexpected_unattempted_region_count = 0`.
- `preserved_sfx_region_count` is reported rather than treated as failure.
- Pixels outside repair support remain unchanged.
- Median runtime on the approved ten pages is at most 30 seconds.
- Affected protection, eligibility, pipeline, detector, and benchmark tests pass.
- Frontend and production build suites are not rerun because no UI or API contract changes.
- The user reviews regenerated contact sheets before final acceptance.

## 9. Trade-offs

The policy keeps confident visual sound effects and avoids extra detector cost. It may still clean low-confidence SFX because those regions are intentionally routed through `REVIEW` to favor sentence recall. Conversely, a prose region whose visual features strongly resemble SFX may be preserved. Manual retry and `Force Clean` remain the recovery path for that false negative.
