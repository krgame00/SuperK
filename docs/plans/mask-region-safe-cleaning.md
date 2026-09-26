# Mask region safe cleaning — execution record

Status: VERIFIED WORKING. Automated tests and all Region 17 live release checks are complete.

| Ticket | Implementation | Verification |
| --- | --- | --- |
| 01 Boundary-safe manual mask | Normalize <=2 px overflow, refuse larger overflow and empty force mask; backend clips to selected rectangle and refuses empty. | MaskEditor and Python authorization regressions; live Region 17 final image changed zero pixels outside selected rectangle and final mask. |
| 02 Cleaner restart recovery | Rebuild missing job, prefer matching identity and bounded geometry, reject weak/ambiguous matches, intersect edits with recovered region. | useCleaning recovery cases and MaskEditor remap case. |
| 03 Proposal-first Clean Now | Reuse proposal, attempt one refresh if empty, stop when still empty; no rectangle fallback. | MaskEditor no-proposal and refresh tests. |
| 04 Stable authorization revision | Confirm text before force-clean, reuse the approved mask, retain confirmation across failed force attempts, require exact approved revision in backend. | MaskEditor retry test and Python revision tests. |
| 05 Restart persistence | Require both persisted blobs and fingerprint match; missing approval revision restores as unapproved. | useCleaning restore and client decode tests. |
| 06 Region 17 release gate | Browser replay of original `source.png`, once with an isolated empty cleaner cache and once with a 2 px brush centered on the region boundary. | Stale replay rebuilt clean/confirm/force jobs without surfacing "Job not found". Bounded-drift final job `feeac6de801e463a85af75a59fce2c1e` repaired and approved Region 17; editor stayed open with adjustment notice. Against preceding job `72ce20f6e9d749b19e0851e6ddfe3afa`: 128 changed pixels inside Region 17, zero outside its rectangle, zero outside final mask. |

Final command results: Vitest 144 files and 929 tests passed (one file/test skipped); OCR service 186 passed, 3 skipped; TypeScript passed; scoped ESLint reported 0 errors and 4 existing page warnings; `git diff --check` passed.

Independent review found that a second action after a stale-job alias could still submit the editor's original mask. The hook now intersects aliased actions before sending them; the recovery regression asserts the second action uses a new clipped blob and preserves only pixels inside the shifted rectangle. Same-ID rectangle shifts report an adjustment. Focused MaskEditor/useCleaning tests passed 49/49 after these corrections.
