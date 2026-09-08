# 03: Canvas Mutation Autosave Advance & Export Cache Invalidation (P1)

**What to build:** Every direct interaction on the canvas—dragging a speech bubble, modifying dialogue text, changing font settings, or clicking undo/redo—immediately advances the page's revision version, registers with the autosave scheduler, and evicts cached pre-rendered export images. Exporting a manga page or book immediately renders from the active canvas state, preventing stale, pre-edit translations from ever reaching exported output.

**Blocked by:** 02: Monotonic Per-Page Version Tracking & Autosave Concurrency (P1)

**Status:** ready-for-agent

- [ ] Canvas mutation listeners in the overlay system explicitly call revision-advancing notifications on bubble movement, text input, and style change.
- [ ] Undo and redo actions increment the page revision number and trigger autosave debounce.
- [ ] Pre-rendered export image cache for a page is immediately deleted when that page's overlays mutate.
- [ ] Export manager re-renders from current overlay layout when render cache is missing or invalidated.
- [ ] Integration tests verify that moving a bubble and immediately exporting outputs an image with the new position, not the cached old position.
