# 02: Centered SuperK Spinning Logo & Progress Card

**What to build:** Renders an elegant glassmorphism card positioned squarely in the center of the active manga panel, containing an animated spinning SuperK emblem, smooth cyan spinner ring, and clear Thai progress text ("SuperK กำลังแปลภาพนี้..."). Includes full clean lifecycle cleanup when translation succeeds or transitions to the retry badge on error.

**Blocked by:** 01: Zero-Scrollbar Loading Scrim Portal Container

**Status:** done

- [x] Center of `.superk-loading-scrim-container` houses `.superk-loading-card` with frosted glass backdrop and drop shadow.
- [x] Card displays spinning SuperK brand emblem, animated glowing accent ring, and "SuperK กำลังแปลภาพนี้..." label.
- [x] `handleTranslationSuccess` removes the loading scrim smoothly before displaying translated bubbles and inpainted background.
- [x] `handleTranslationError` replaces the loading card with an actionable error notification and "🔄 ลองใหม่" (Retry) button.
- [x] Animation respects `prefers-reduced-motion: reduce`.
