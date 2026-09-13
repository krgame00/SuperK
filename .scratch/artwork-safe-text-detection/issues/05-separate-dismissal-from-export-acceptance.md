# 05: Separate warning dismissal from explicit export acceptance

**What to build:** A reader can explicitly accept and export the current page with uncertain regions preserved. Closing a review warning only hides the warning presentation; it does not accept the page, approve text or masks, or trigger additional processing.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Closing the per-page review warning leaves the page unconfirmed; a subsequent export still requires explicit acceptance.
- [x] Explicit single-page or batch acceptance exports the existing image and translation revision, including intentionally preserved regions.
- [x] Export acceptance does not invoke cleaning or translation, approve any proposed mask, or resolve text-candidate review state.
- [x] Exported content matches the accepted current state; image or translation changes require fresh acceptance.
- [x] Dismissed review presentation does not prevent the user from inspecting outstanding review information or reaching explicit export acceptance.
- [x] Existing export formats and destinations retain their behavior; no automatic restoration of already damaged pixels is implied.
- [x] Tests exercise actual workspace warning-dismissal and confirmation handlers, including deferred export and batch selection, rather than testing export-button callbacks alone.
- [x] A preserved uncertain-page fixture verifies that export makes no cleaning/translation calls and leaves underlying image assets unchanged.

## Scope and verification

This independent slice can use existing uncertain-page results, so it does not depend on the new detection or manual-approval flows. Preserve existing revision invalidation and verify final integration with the shared review semantics when the other slices land.

## Comments

Breakdown and testing seams approved by the user on 2026-09-14.
