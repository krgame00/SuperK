# 04: Preserve review authorization across restoration and cached preparation

**What to build:** Reopening a project or reusing a prepared page restores its text-review and mask-approval state accurately. Old, stale or incomplete stored results cannot silently permit uncertain artwork removal or translation, and successfully saved user work remains editable.

**Blocked by:** 03 — Confirm text and approve its removal mask separately.

**Status:** completed

- [x] Reload restores uncertain candidates, text confirmations, proposed masks and valid Removal-mask approvals consistently in both service behavior and the workspace.
- [x] Missing approval metadata in legacy projects does not count as approval; reopening does not automatically remove or translate uncertain candidates.
- [x] Prepared-page reuse validates source, authorized mask and cleaning-policy identity so an older permissive result cannot bypass current authorization.
- [x] Source or proposed-mask revision changes invalidate affected approvals before cleaning or retry; unchanged valid decisions remain reusable.
- [x] Cancellation and late preparation results preserve successful assets where allowed but cannot resume cancelled work or promote stale approvals.
- [x] Restore and migration preserve existing user edits and retained source assets; changing a status is not reported as repairing already damaged imagery.
- [x] Regional review does not discard confident-region progress or incorrectly convert ordinary text uncertainty into page-level preparation failure.
- [x] Image or translation changes continue to invalidate Confirmed page revision acceptance under existing export semantics.
- [x] Round-trip workspace restore tests and public pipeline/cache tests cover a mixed page, a legacy result, matching reuse, mismatched revisions and cancellation/late completion.

## Scope and verification

Build on live approval semantics from ticket 03 and the conservative compatibility guard in ticket 01. Reuse existing project storage and prepared assets; do not introduce a second large cache or broaden the project's recovery guarantees beyond retained saved data.

## Comments

Breakdown and testing seams approved by the user on 2026-09-14.
