# Extension Centered Loading Scrim Overlay & Zero-Scrollbar Design

Status: ready-for-agent
Triage: ready-for-agent
Domain Glossary: CONTEXT.md
Reference: docs/adr/0001-extension-parity-scope.md

---

## Problem Statement

When manga readers trigger the SuperK Chrome Extension to translate a manga panel in the reading view, the existing loading indicator creates severe visual disruption on the host website:

1. **Unwanted Scrollbars (สกอบาร์)**: The legacy loading badge injects directly into the image's parent element (`img.parentElement.appendChild(badge)`) while forcibly overwriting `parent.style.position = 'relative'`. On manga reader websites using flexbox, CSS grid, or strict layout containers, this sudden modification and the badge's `left: 50%; transform: translateX(-50%);` styling forces the container to expand beyond the viewport bounds, instantly triggering unwanted horizontal and vertical scrollbars.
2. **Poor Visual Hierarchy & Occlusion**: The badge floats at the top edge (`top: 12px; left: 50%`), which frequently collides with website sticky navigation headers, reader toolbar controls, or panel borders. Readers naturally look at the center of the dialogue artwork they selected, not at the top border.
3. **Low Contrast Feedback**: The small pill badge lacks visual prominence against busy manga panels (halftone screentones, dark battle scenes, or color pages), making it difficult to immediately tell that an image is actively translating.
4. **Clipping on Small Panels**: On smaller panels (e.g. 4-koma strips or cropped sound effects), the fixed-size top badge overflows the image bounds, overlapping neighboring comic panels.

---

## Solution

Replace the top-anchored badge and destructive parent DOM modification with an elegant, centered **loading scrim overlay**:

1. **Zero-Scrollbar Absolute Overlay**: Mount the loading container using exact viewport bounding coordinates (`getBoundingClientRect()` + scroll offsets) directly onto `document.body`—the same isolated portal pattern used for speech bubble overlays. The container perfectly matches the image dimensions with `overflow: hidden` and `pointer-events: none`, causing **zero DOM manipulation** to `parent.style` and completely eliminating unwanted scrollbars.
2. **Centered SuperK Spinning Logo & Progress**: Position a glassmorphism card squarely in the center of the active manga panel featuring an animated spinning SuperK brand emblem, smooth accent spinner ring, and clear "SuperK กำลังแปลภาพนี้..." status label.
3. **Gentle Dimming Scrim**: Apply a soft 25% dark translucent backdrop mask with subtle blur across only the target image during translation, immediately drawing the reader's attention to the processing panel and establishing clear feedback.
4. **Adaptive Responsive Sizing**: Automatically detect panel dimensions: standard and large manga panels display the complete centered card with logo, spinner, and Thai label; compact panels (< 180px in width or height) dynamically collapse into a minimalist spinning icon that fits within the panel bounds without overflowing.
5. **Clean Lifecycle Transitions**: When translation succeeds, the loading scrim overlay smoothly fades out as the inpainted clean background and speech bubble overlays appear. If an error occurs, it cleanly transitions into an actionable error badge with a one-click Retry button.

---

## User Stories

1. As a manga reader in the reading view, I want to trigger translation on any manga panel without causing horizontal or vertical scrollbars to spawn on the webpage, so that my reading layout remains completely stable.
2. As a manga reader, I want the translation loading indicator to appear squarely in the center of the selected manga panel rather than at the top edge, so that visual feedback is positioned right where my attention is focused.
3. As a manga reader, I want an animated spinning SuperK logo in the center of the panel while translating, so that progress feedback feels lively, modern, and branded.
4. As a manga reader, I want a gentle dimming scrim over the panel while translation is underway, so that I can clearly tell at a glance which image is being processed.
5. As a manga reader, I want the loading indicator to leave the host website's parent DOM elements completely untouched, so that the reading site's flex, grid, and navigation layouts are never distorted.
6. As a manga reader translating a small comic panel, I want the loading indicator to automatically scale down to a compact spinning icon, so that it never spills outside the panel borders.
7. As a manga reader, I want the loading scrim to have pointer-events disabled, so that I can still scroll and navigate the reading site freely while translation runs in the background.
8. As a manga reader, I want the loading scrim to fade out instantly when translation completes and cleanly yield to the translated speech bubbles and inpainted clean background.
9. As a manga reader, I want the loading scrim to transition seamlessly into an actionable error badge with a retry button if translation fails, so that I can recover with a single click.
10. As a manga reader with motion sensitivity, I want animations to respect `prefers-reduced-motion: reduce` and display a static elegant progress badge instead of rapid spinning.
11. As a manga reader translating multiple manga panels on a long web page, I want each panel to independently display its own centered loading scrim without interference.
12. As a manga reader, I want the loading scrim to maintain alignment if the window is resized while translation is processing.

---

## Implementation Decisions

1. **Document-Body Portal Anchoring**:
   The loading container (`.superk-loading-scrim-container`) is appended directly to `document.body` with exact absolute pixel coordinates calculated from `img.getBoundingClientRect()` plus `window.scrollX`/`scrollY`. Its styles enforce:
   `position: absolute; pointer-events: none; overflow: hidden; z-index: 99998; border-radius: 4px;`
   The legacy `parent.style.position = 'relative'` call in `positionBadgeOverImage()` is permanently deleted.

2. **Centered Glassmorphism Card & SuperK Emblem**:
   Inside the container, a flexbox-centered card (`.superk-loading-card`) is styled with `backdrop-filter: blur(8px)`, background `rgba(15, 23, 42, 0.82)`, border `1px solid rgba(56, 189, 248, 0.3)`, and drop shadow. It houses:
   - An SVG/CSS SuperK stylized emblem spinning smoothly.
   - An outer glowing cyan accent ring (`#38bdf8`).
   - A bold text label: `SuperK กำลังแปลภาพนี้...` set in the project font (`'Itim', sans-serif`).

3. **Subtle Panel Scrim Backdrop**:
   The container background utilizes `rgba(0, 0, 0, 0.25)` to softly dim only the active panel image, leaving surrounding webpage content unaffected.

4. **Responsive Adaptive Threshold**:
   When the target image has `renderW < 180 || renderH < 180`, the container receives a `.superk-compact` class. In compact mode, the text label is hidden (`display: none`), padding is reduced, and the spinner scales down to 22px to guarantee perfect containment within small dialogue sound-effect crops.

5. **Lifecycle Coordination**:
   - `handleTranslationStart(imageUrl)`: Constructs and inserts the centered `.superk-loading-scrim-container`.
   - `handleTranslationSuccess(imageUrl, ...)`: Fades out and tears down the loading container immediately before appending `.superk-overlay-container`.
   - `handleTranslationError(imageUrl, error)`: Replaces the loading card with the centered error notification containing the `🔄 ลองใหม่` (Retry) action button.

---

## Testing Decisions

- **Test Seam**: High-level DOM integration tests in `tests/chrome-extension/content.test.ts`.
- **External Behavior Verification**:
  - Verify that `handleTranslationStart` mounts a `.superk-loading-scrim-container` directly to `document.body` without mutating `img.parentElement.style.position`.
  - Verify that the loading container matches the exact width, height, and coordinates of the target image and has `overflow: hidden`.
  - Verify that a standard manga image renders the full centered loading card containing the spinning SuperK icon and "กำลังแปล" text.
  - Verify that a small image (< 180px) activates the compact mode without text overflow.
  - Verify that `handleTranslationSuccess` and `handleTranslationError` cleanly remove the loading scrim without leaving orphan DOM elements.
- **Prior Art**:
  - `tests/chrome-extension/content.test.ts`
  - `tests/chrome-extension/adaptiveBubbleOverlay.test.ts`

---

## Out of Scope

- Full-viewport modal overlays that lock reader interaction on the rest of the web page.
- Fine-grained progress percentages (Gemini translation and inpainting polling are staged async operations without granular byte counts).

---

## Further Notes

- By eliminating `parent.style.position = 'relative'` and keeping the loading scrim within `document.body` with `overflow: hidden`, any horizontal and vertical scrollbar flickering on reader sites is permanently resolved.
