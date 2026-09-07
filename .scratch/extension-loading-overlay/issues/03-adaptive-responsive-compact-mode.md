# 03: Adaptive Responsive Sizing for Compact Panels

**What to build:** Automatically detects image dimensions: standard panels show the full card with logo and text, while small panels (< 180px width or height) automatically collapse into a sleek, minimalist 22px spinning icon, preventing overflow or clipping on compact comic crops.

**Blocked by:** 02: Centered SuperK Spinning Logo & Progress Card

**Status:** done

- [x] Evaluates rendered image dimensions; if `width < 180 || height < 180`, attaches `.superk-compact` to the container.
- [x] In compact mode, hides the text label and scales the spinner and emblem down to fit inside miniature crops without clipping.
- [x] Automated DOM integration tests verify that panels under 180px render compact mode and panels 180px+ render full card.
