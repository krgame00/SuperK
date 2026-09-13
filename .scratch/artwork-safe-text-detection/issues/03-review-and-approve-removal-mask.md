# 03: Confirm text and approve its removal mask separately

**What to build:** A reviewer can confirm that a candidate contains text without changing the image, inspect and correct its proposed mask on the source image, then explicitly approve the pixels that cleaning may replace. The approval must govern actual service operations, not only the UI.

**Blocked by:** 01 — Preserve Unconfirmed text candidates while processing confident text.

**Status:** completed

- [x] Text confirmation alone leaves source and clean-image pixels unchanged, grants no mask approval and automatically starts no translation or cleaning request.
- [x] The reviewer can inspect the proposed removal mask against the source image and correct it before approval using the existing editing experience where practical.
- [x] Cleaning a reviewed candidate requires explicit Removal-mask approval; service validation prevents bypassing the UI sequence.
- [x] Cleaning changes no pixels outside the authorized Text-removal mask, even when the cleaner receives a larger context region.
- [x] Manual retry, residual handling and adaptive cleaning obey the same approval and cannot silently enlarge it.
- [x] Approval applies to the inspected source and mask revision. Changing either invalidates that approval; stale or late operations cannot apply an outdated authorization to a new revision.
- [x] Confirmed text becomes eligible for subsequent user-requested translation without treating text confirmation as mask approval. Unconfirmed candidates remain excluded.
- [x] Existing source assets, unrelated regions and user edits remain intact during region review actions.
- [x] Interaction tests cover confirm, inspect, edit and approve; pipeline tests verify exact outside-mask pixel identity and rejection of unapproved or stale operations.

## Scope and verification

Deliver one complete reviewed-region path from user action through the service and back to the displayed image. Use the established application and pipeline testing seams. Long-term restoration and prepared-result reuse are covered comprehensively by ticket 04, while this ticket owns live revision correctness.

## Comments

Breakdown and testing seams approved by the user on 2026-09-14.
