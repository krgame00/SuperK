# 07: Human Review Confirmation Gate for Uncertain Exports

**What to build:** The manga translation workspace detects pages with uncertain cleaning or low-confidence translations and blocks export operations until a reviewer explicitly confirms each flagged page. Confirmation applies strictly to the reviewed image and dialogue revision; any subsequent modification to dialogue text, bubble positions, or artwork automatically resets confirmation, requiring the reviewer to re-verify before export.

**Blocked by:** 03: Canvas Mutation Autosave Advance & Export Cache Invalidation (P1)

**Status:** ready-for-agent

- [ ] Pages with uncertain cleaning or low-confidence translations are tagged with an `unreviewed` review status.
- [ ] Export action evaluates all target pages; if any page has an `unreviewed` status, export is blocked with a dialog listing unconfirmed pages.
- [ ] Reviewer can inspect flagged pages and click an explicit "Confirm Page" action to mark it `confirmed`.
- [ ] Any subsequent edit to bubbles, text, font, or image on a confirmed page immediately resets its status to `unreviewed`.
- [ ] Export manager integration tests verify that unconfirmed pages block export and confirmation invalidation works upon canvas mutation.
