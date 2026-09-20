# Post-mortem: translated overlay edits reset after page switch

## Summary

Moving/resizing/rotating a translated bubble could be lost when the workspace remounted a page, and per-bubble font-size edits relied on a separate persistence path. The web editor split interactive state between `TranslatedBubble` and `superk:overlay-adjustments` localStorage. Imported pages use durable base64 data URLs, and the full data URL was used as the localStorage page key, making fallback persistence large enough to hit browser quota silently. The fix in the current `main` working tree (durable goal `persist-overlay-edits-across-page-switch`) makes bubble/session state authoritative and keeps compact localStorage only as a legacy fallback.

## Symptom

The user could move translated text or increase its size, switch to another page, then return and see the edited text reconstructed from its previous/original layout rather than the committed edit.

## Root cause

`lib/translationOverlay.ts::saveAdjustment()` persisted `bx`, `by`, `bw`, `bh`, and `rotation` only in the `superk:overlay-adjustments` localStorage record. Geometry was not part of `TranslatedBubble`, while `fontSizeMultiplier` was stored directly on the bubble. This created two sources of state.

`src/app/page.tsx::processFiles()` converts imported image blobs to durable base64 data URLs. `hooks/useTranslation.ts` passes the page URL to `applyTranslationOverlay()` as `pageKeyOverride`. Before the fix, `applyTranslationOverlay()` used that full base64 string as the localStorage object key. `saveOverlayAdjustments()` intentionally catches storage errors, so a quota failure removed the only persisted geometry signal without surfacing an error.

When the page was mounted again, `hooks/useTranslation.ts` restored the bubble cache and reapplied the overlay. Because the bubble itself had no geometry, `applyTranslationOverlay()` had to recover geometry from localStorage; if that record was unavailable, it rebuilt from the original OCR `box`.

## Why it produced the symptom

The live overlay keeps `currentBx/currentBy/currentBw/currentBh` in closure state, so dragging looks correct immediately. Switching pages destroys that DOM/closure. The new overlay generation can only reconstruct from durable state. Geometry was not in the IndexedDB-persisted bubble record, so localStorage failure meant the only remaining input was the original box. Font size already lived on the bubble, but it was part of the same split-state design and now has the same explicit bubble-owned contract.

## Fix

`TranslatedBubble` now has `layoutAdjustment?: OverlayAdjustment`. Every committed move/resize/rotate/font-related adjustment writes the current geometry to `b.layoutAdjustment` before `onBubblesMutated()` marks the page dirty. The existing autosave path in `hooks/useTranslation.ts` persists the bubble cache through `saveProjectSession()`, whose structured-clone preparation preserves ordinary bubble fields while removing only the runtime `render` function.

On restore, `applyTranslationOverlay()` now prefers `b.layoutAdjustment` and uses localStorage only as a legacy fallback. Long page keys are compacted to a deterministic FNV-1a-derived key before new fallback writes; the old raw page key is still checked on read for backward compatibility.

## How it was found

Source tracing followed the actual workflow: image import → durable data URL → page-key override → interactive `saveAdjustment()` → bubble/session autosave → page remount. Two TDD regressions isolated the cause. Before the production change, the session-style JSON roundtrip had no `layoutAdjustment`, and the localStorage JSON contained the entire 20,000-character test data URL. Both tests failed for those exact reasons before the fix.

## Why it slipped through

Existing overlay tests verified that dragging/resizing worked while the overlay was mounted, and localStorage unit tests verified simple read/write behavior using short `page-N` keys. They did not exercise the production seam where imported pages use large base64 data URLs, the overlay is destroyed, localStorage is unavailable, and state must survive through the bubble/session representation.

## Validation

- New overlay persistence regressions: **18/18 passed** after first reproducing the two failures RED.
- Focused overlay/session/export persistence set: **4 files / 35 tests passed**.
- Full Vitest suite: **141/141 files / 846/846 tests passed**.
- `npx tsc --noEmit`: exit 0.
- Scoped ESLint on `lib/translationOverlay.ts` and `tests/cleaning/translationOverlay.test.ts`: exit 0.
- `npm run build`: exit 0.
- Scoped `git diff --check`: exit 0.
- Independent delegated reviewer was unavailable because the workspace delegate provider is disabled; direct end-to-end trace and full automated verification were completed instead.

## Action items / follow-ups

None — the fix moves the state to the existing persisted bubble model and adds regression coverage at the previously missing remount/data-URL seam. No additional production subsystem is required.
