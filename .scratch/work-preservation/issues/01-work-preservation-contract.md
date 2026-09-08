# 01: Local Project Recovery, Work Preservation & Review-Gated Export

**What to build:** Establish an ironclad contract for work preservation, local persistence, and review-gated export across the translation workspace and reading view. Fix failed re-clean invalidation, per-page monotonic autosave version tracking, direct canvas edit persistence, export cache invalidation, reading-site association persistence, publication polling deduplication, project-lifetime asset retention, and human confirmation gating for uncertain exports.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A failed re-clean operation leaves existing translation bubbles, clean backgrounds, and rendered image caches completely intact.
- [ ] Direct overlay edits (bubble move, text edit, font change, undo/redo) immediately advance page revision, mark dirty, schedule autosave, and invalidate export cache.
- [ ] In-flight autosave to IndexedDB tracks per-page monotonic revisions so newly typed edits during save remain marked dirty.
- [ ] Project store serialization and deserialization preserves `originUrl` so "Send back to reading view" works after browser reload.
- [ ] Publication polling applies strictly monotonic sequence/cursor filtering to prevent replaying older editor results over newer reading changes.
- [ ] Cleaned assets and parent inpainting jobs remain retained for project lifetime and are removed upon project deletion.
- [ ] Export blocks pages with uncertain text or inpainting until confirmed by human reviewer, resetting confirmation upon any subsequent edit.
- [ ] Specification defined in [docs/superpowers/specs/2026-09-08-system-review-work-preservation-spec.md](file:///c:/Users/PC/Downloads/manga-translator/docs/superpowers/specs/2026-09-08-system-review-work-preservation-spec.md).
