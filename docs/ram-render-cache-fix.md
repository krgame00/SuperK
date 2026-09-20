# Render-cache memory ownership fix

## Problem and decision

`WorkspaceResourceManager` evicted translated renders from its budget but copied
their strings into `SessionProcessedPageSpillCache`, an unbounded in-memory Map.
Usage could report zero while the manager still retained every evicted render.

Drop these recomputable renders on eviction. Do not introduce asynchronous disk
spilling: the workspace already handles a cache miss by rendering saved bubbles
and edits against the source/clean image for export. Resident renders still need
an exact revision match. Source data, bubbles, edits, and persisted sessions are
not removed by this change.

## Change

- Remove the spill-cache dependency and ownership from WorkspaceResourceManager.
- Return null for evicted renders, including when the revision still matches.
- Preserve warm-page eviction priority and resident revision validation.
- Update acceptance tests that previously required an unbudgeted spill copy.
- Add regressions for oversized renders and a 100-page sequence, including
  registering a freshly rebuilt render after eviction.

The unused standalone sessionSpillCache utility and its dedicated tests were
removed in the follow-up cleanup. WorkspaceResourceManager still returns a
cache miss after eviction, and callers regenerate the render from saved bubbles.

## Verification and limits

The two new regression tests failed against the old implementation, then passed
after this change. Targeted lifecycle, export, restore, and workflow tests passed
(16 files, 89 tests). The full suite passed (141 files, 848 tests), and
TypeScript `--noEmit --incremental false` passed. Run logs are in
`scratch/ram-fix-full-tests.log` and `scratch/ram-fix-types.log`.

This fixes unbounded render retention in this manager, not a hard cap on total
browser memory. Source images, decoded canvases, other bounded caches and browser
GC have separate lifetimes. A cache miss may require additional rendering time.
No claim of measured browser RSS reduction or real-browser export verification
is made from these unit/integration tests.
