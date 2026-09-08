# 05: Monotonic Sequence Deduplication for Extension Publication (P1)

**What to build:** The publication bridge between the full translation workspace and the Chrome extension reading view applies strictly monotonic sequence IDs and cursor filtering. Publication polling in the browser extension ignores already applied publication snapshots, preventing repeated broadcasts from replaying older editor states, overwriting newer reading changes, or reverting deliberate reader deletions.

**Blocked by:** 04: Preserved Reading-Site Metadata & Handoff Data URL Persistence (P2)

**Status:** ready-for-agent

- [ ] Publication endpoint assigns unique, strictly increasing sequence identifiers to each published translation update.
- [ ] Publication polling query excludes records with sequence IDs less than or equal to the client's recorded cursor (`id > cursor`).
- [ ] Extension background worker records the highest applied publication sequence ID and ignores duplicates.
- [ ] Integration tests verify that repeated polling does not re-apply older publication entries or undo page deletions on the reading site.
