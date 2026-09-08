# 02: Monotonic Per-Page Version Tracking & Autosave Concurrency (P1)

**What to build:** Translators typing rapidly or making continuous edits while an asynchronous autosave operation writes to IndexedDB never lose their new edits. The autosave subsystem tracks monotonic revision numbers per page, clearing only the revision captured when the write began so that subsequent edits arriving during the save remain marked dirty and trigger a follow-up autosave.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Mutable shared dirty set is replaced with per-page monotonic revision tracking (`pageRevisions` and `lastSavedRevisions`).
- [ ] Save operation captures the exact revision snapshot per page before starting asynchronous IndexedDB persistence.
- [ ] Upon successful save completion, only pages whose current revision matches the saved revision are marked clean; pages modified during the save remain dirty.
- [ ] Concurrency unit/integration test simulates in-flight save delays while injecting new text edits, verifying that new edits trigger a subsequent autosave and survive reload.
