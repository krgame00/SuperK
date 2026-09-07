# 03: Adaptive Speech Bubble Overlay & Local Persistence

**What to build:** The extension content script shapes translated Thai dialogue inside speech bubbles using SuperK's adaptive text-fitting algorithm, matching font family, font size multipliers, line breaks, text color, and outline strokes. It provides an on-image floating toggle to flip between the translated overlay and original Japanese image, an explicit "Delete Translation" button, an explicit "Retranslate" button, and persists the translated overlay in extension storage keyed by image URL so that reloading the web page loads the translation instantly without consuming API quota.

**Blocked by:** 02: Inpainting Pipeline & Actionable Error Recovery

**Status:** done

- [x] Extension uses adaptive bubble layout algorithm to shape Thai text inside oval and rectangular bubble bounds.
- [x] Text styling (font size multiplier, font family, text color, stroke outline) mirrors SuperK settings.
- [x] Floating controls allow toggling original/translated views, retranslating, and deleting saved translation.
- [x] Translation overlays are persisted in extension local storage by image URL and auto-restored on page reload.
- [x] Tests verify DOM/canvas overlay rendering, text fitting bounds, toggle actions, and local cache restoration.
