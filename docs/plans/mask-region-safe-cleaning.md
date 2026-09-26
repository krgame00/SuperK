# Mask region safe cleaning — execution record

Status: VERIFIED WORKING for the implemented code paths; live stale-job and boundary-drift replay remain a manual release check.

| Ticket | Implementation | Verification |
| --- | --- | --- |
| 01 Boundary-safe manual mask | Normalize <=2 px overflow, refuse larger overflow and empty force mask; backend clips to selected rectangle and refuses empty. | MaskEditor and Python authorization regressions; live Region 17 final image changed zero pixels outside selected rectangle and final mask. |
| 02 Cleaner restart recovery | Rebuild missing job, prefer matching identity and bounded geometry, reject weak/ambiguous matches, intersect edits with recovered region. | useCleaning recovery cases and MaskEditor remap case. |
| 03 Proposal-first Clean Now | Reuse proposal, attempt one refresh if empty, stop when still empty; no rectangle fallback. | MaskEditor no-proposal and refresh tests. |
| 04 Stable authorization revision | Confirm text before force-clean, reuse the approved mask, retain confirmation across failed force attempts, require exact approved revision in backend. | MaskEditor retry test and Python revision tests. |
| 05 Restart persistence | Require both persisted blobs and fingerprint match; missing approval revision restores as unapproved. | useCleaning restore and client decode tests. |
| 06 Region 17 release gate | Browser run of `source.png` from cached job `ffdc3263f7534fc6809dee81b463a312` through Clean Now. | Final job `c88205b0cac64f5fb54f8a55315c2a03`: Region 17 repaired, confirmed, approved with revision; 13,278 pixels changed inside selected region, zero outside region, zero outside final mask. Stale-job and 2 px drift verified deterministically, not replayed in live browser. |

Final command results: Vitest 144 files and 929 tests passed (one file/test skipped); OCR service 186 passed, 3 skipped; TypeScript passed; scoped ESLint reported 0 errors and 4 existing page warnings; `git diff --check` passed. The browser run did not replay stale-job recovery or 2-pixel boundary drift.

Independent review found that a second action after a stale-job alias could still submit the editor's original mask. The hook now intersects aliased actions before sending them; the recovery regression asserts the second action uses a new clipped blob and preserves only pixels inside the shifted rectangle. Same-ID rectangle shifts report an adjustment. Focused MaskEditor/useCleaning tests passed 49/49 after these corrections.
