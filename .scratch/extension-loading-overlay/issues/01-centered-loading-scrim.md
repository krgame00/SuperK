# 01: Centered Loading Scrim Overlay & Zero-Scrollbar Elimination

**What to build:** The extension reading view displays progress while inpainting and translation are underway using a non-intrusive, centered glassmorphism loading scrim overlay directly over the target manga panel. The container mounts via absolute coordinates to `document.body` without altering `img.parentElement.style.position`, completely eliminating unwanted horizontal and vertical scrollbars on the host reading website. Inside, a centered spinning SuperK logo and status label provide clear visual feedback, dynamically collapsing into a minimalist spinning icon on small panels (< 180px).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `handleTranslationStart` constructs a `.superk-loading-scrim-container` attached to `document.body` using `img.getBoundingClientRect()` with zero mutation of `parent.style`.
- [ ] Loading container contains `overflow: hidden`, `pointer-events: none`, and a gentle 25% dimming scrim over the active manga image.
- [ ] Center of the container renders `.superk-loading-card` with an animated spinning SuperK emblem, accent spinner, and "SuperK กำลังแปลภาพนี้..." text.
- [ ] When image width or height is under 180px, compact mode engages, hiding text and showing only the 22px spinner to prevent overflow.
- [ ] `handleTranslationSuccess` and `handleTranslationError` cleanly remove the loading scrim upon completion.
- [ ] Integration tests in `tests/chrome-extension/content.test.ts` verify DOM position, zero parent mutation, and cleanup.
