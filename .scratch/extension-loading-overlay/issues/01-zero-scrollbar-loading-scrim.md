# 01: Zero-Scrollbar Loading Scrim Portal Container

**What to build:** Eliminates unwanted webpage scrollbars by replacing the invasive `parent.style.position = 'relative'` mounting with an isolated, absolute-positioned portal container appended directly to `document.body`. Matches target manga image coordinates exactly with `overflow: hidden` and `pointer-events: none`, applying a soft 25% dimming scrim across only the active panel.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `handleTranslationStart` constructs a `.superk-loading-scrim-container` attached to `document.body` using `img.getBoundingClientRect()` with zero mutation of `parent.style`.
- [x] Loading container enforces `overflow: hidden`, `pointer-events: none`, and a gentle 25% dimming scrim over the active manga image.
- [x] Legacy `parent.style.position = 'relative'` in `positionBadgeOverImage()` is completely removed.
- [x] Unit/Integration tests verify container creation, positioning, and zero modification to `img.parentElement.style.position`.
