# 01: Preserve Unconfirmed text candidates while processing confident text

**What to build:** A mixed page keeps ambiguous artwork unchanged and exposes Unconfirmed text candidates for inspection, while confident regions continue through cleaning and translation. Carry this distinction through the service contract, workspace display, translation requests and result integration; a review label alone must not permit cleaning.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] An uncertain candidate remains inspectable with its proposed mask separate from the authorized Text-removal mask.
- [x] Automatic cleaning preserves the candidate's pixels; an artwork-only uncertain page produces no automatic removal or translation work.
- [x] Confident regions on the same page still clean and translate, and unrelated batch pages continue under existing scheduling limits.
- [x] Unconfirmed candidates are excluded from translation work selection and rendered results, including when a translation response returns an excluded candidate. Account for page-image translation rather than relying only on a display flag.
- [x] Normal and adaptive cleaning, automatic retries and residual processing cannot promote an unconfirmed candidate into authorized removal.
- [x] Regional text uncertainty remains distinct from page-level preparation failure; existing bounded quality recovery and failure behavior remain intact.
- [x] New result metadata has consistent service/client meaning. Absent metadata cannot grant approval; retain existing user assets and edits.
- [x] Public cleaning-pipeline tests verify pixel preservation and mixed-page output; workspace translation tests verify requests, response integration and visible review state using deterministic fixtures.

## Scope and verification

Implement the smallest complete authorization path using existing detector evidence and review decisions. Detector calibration belongs to ticket 02, manual approvals to ticket 03, and comprehensive restore/cache behavior to ticket 04. Include the compatibility guard needed to avoid admitting older permissive results immediately; do not postpone a known authorization bypass.

## Comments

The user approved this breakdown and the cleaning-pipeline plus workspace translation/review/export testing seams on 2026-09-14. The source spec's earlier draft status is retained unchanged; this approval records the resolved testing-seam decision for these tickets.
