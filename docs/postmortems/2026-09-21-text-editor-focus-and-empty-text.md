# Text editor focus exit and empty-text restoration

## Summary

Keyboard navigation through editor action buttons could leave live text uncommitted. Saving empty text also removed its selectable bubble after overlay reconstruction. Both are fixed in `lib/translationOverlay.ts`.

## Root cause

The textarea-only blur listener deferred commit when focus entered an action button, but never received another event when that button lost focus. Input had mutated the bubble without marking persistence dirty or recording undo.

Overlay reconstruction excluded every empty string even if the bubble retained saved geometry and was not deleted. Clearing text therefore removed its editing surface on reconstruction.

## Fix

Observe bubbling focusout on the whole editor. Commit only after focus leaves it, once, preserving focus on the destination. Explicit save still restores wrapper focus.

Keep non-deleted bubbles with saved layout adjustments even when text is empty. Their canvas stays blank and their geometry remains editable. Empty detection results without saved geometry and deleted bubbles remain excluded.

## Validation

- Both regression tests failed before the fix and passed afterward.
- Coverage includes internal focus navigation, external focus preservation, one undo transaction with redo, and JSON-roundtripped empty text that can be reopened and refilled.
- Focused suite: 17 files / 121 tests passed before strengthening the assertions.
- Final full Vitest suite: 139 files / 839 tests passed.
- TypeScript and scoped diff whitespace check passed.
- Existing jsdom canvas/localStorage warnings remain. No manual browser check or production build was performed.

## Why tests missed it

Existing tests covered typing, Escape and explicit save, but not moving focus through a button before leaving. Persistence tests used nonempty text rather than a saved empty string.
