# Chrome Extension Parity with SuperK

Status: ready-for-agent
Reference: docs/adr/0001-extension-parity-scope.md

---

## Problem Statement

Manga readers who browse Japanese manga directly on web publishers and scanlation sites currently face an inconsistent and subpar experience when using the SuperK Chrome Extension compared to the full SuperK web application:

1. **Visual Disparity**: The Chrome extension erases original text by painting crude, flat white rectangles (`#ffffff`) over speech bubbles and rendering plain unstyled HTML text. In contrast, the SuperK web workspace utilizes a local AI inpainting engine that restores screentones and background artwork, paired with an adaptive text-fitting algorithm that shapes Thai dialogue naturally within speech bubbles.
2. **Configuration Fragmentation**: The extension manages its own isolated configuration in Chrome storage, forcing readers to re-enter Gemini API keys, re-select translation models, and lose access to custom glossaries, system prompts, and text styling profiles configured in SuperK.
3. **Workflow Dead-Ends**: If a reader encounters an imperfect machine translation or awkwardly positioned text on a web page, they have no direct way to refine it. To edit the page in SuperK, they must manually take a screenshot, save it to disk, open SuperK, import the image, and re-run recognition and translation from scratch.
4. **Silent Degradation**: When text cleaning or detection encounters difficult panels, the extension silently substitutes white rectangles without warning or recovery options, preventing the reader from understanding or resolving the issue.

---

## Solution

Transform the Chrome extension into a seamless reading companion that operates in direct synergy with the running local SuperK engine:

1. **Engine Parity**: The extension delegates OCR detection and artwork inpainting to the local SuperK backend service (`http://127.0.0.1:8765`), eliminating flat white masks in favor of clean inpainting that matches the main workspace.
2. **Rendering Parity**: Thai dialogue on the reading page is laid out using SuperK's adaptive text-fitting and font rendering engine, producing speech bubbles with identical typography, font sizes, line heights, and stroke outlines.
3. **Unified Settings**: The extension automatically inherits API keys, model priority tiers, glossary rules, and font style preferences from the running SuperK instance.
4. **Seamless Workspace Handoff**: Each translated image on the website provides an "Open in SuperK Editor" button that appends the image, its inpainting assets, and its translated bubbles directly into the user's active SuperK workspace session without wiping existing pages.
5. **Bidirectional Publishing**: Once edits (text correction, manual bubble adjustment, styling changes) are finalized in the SuperK editor, an explicit "Send back to reading view" action immediately updates the reading view on the manga website and saves the refined result.
6. **Local Persistence**: Translated reading results are stored locally per image URL so that page reloads or subsequent visits display the translated manga immediately without repeated API consumption.

---

## User Stories

1. As a manga reader, I want to click a translation trigger on an individual manga image on any website, so that I can translate the page into Thai in place without leaving the site.
2. As a manga reader, I want the extension to use SuperK's local cleaning engine instead of flat white boxes, so that the underlying manga artwork and background details behind the text are preserved.
3. As a manga reader, I want dialogue text in speech bubbles to automatically use SuperK's adaptive text-fitting algorithm, so that long or short sentences fit comfortably inside oval, rectangular, or vertical bubbles without spilling outside.
4. As a manga reader, I want the extension to render Thai text with the font family, font size multiplier, text color, and outline color configured in my SuperK preferences, so that reading feels consistent and polished.
5. As a manga reader, I want the extension to automatically fetch my active Gemini API key and fallback model hierarchy from SuperK, so that I don't have to configure or maintain API credentials in two places.
6. As a manga reader, I want the extension to apply my SuperK glossary and translation rules, so that recurring character names, sound effects, and specialized terms translate accurately on the reading site.
7. As a manga reader, I want translated images to be saved in local storage for that specific page, so that when I refresh the page or return tomorrow, the translated version loads instantly without burning API quota.
8. As a manga reader, I want an on-image toggle button to seamlessly flip between the translated overlay and the original Japanese image, so that I can compare dialogue against the original artwork.
9. As a manga reader, I want an explicit "Delete Translation" button on any saved translation, so that I can remove outdated or unwanted overlays from my browser storage.
10. As a manga reader, I want an explicit "Retranslate" button on any translated image, so that I can re-run translation if I have changed translation settings or glossaries.
11. As a manga reader, I want changing settings in SuperK to NOT automatically re-translate or invalidate my saved reading results, so that my API quota is never consumed on pages I have already read.
12. As a manga reader, I want an informative error banner to appear if inpainting or translation fails, so that I know exactly why an image could not be processed instead of receiving a silent fallback.
13. As a manga reader, I want a "Retry" button when cleaning or translation encounters a temporary failure, so that I can re-attempt translation with a single click.
14. As a manga reader, I want an "Open in SuperK Editor" button on every translated image, so that I can fine-tune dialogue, adjust bubble bounds, or add missing bubbles in the full editor.
15. As a manga reader, I want opening an image for editing to append it to my existing workspace pages rather than replacing my session, so that my existing work-in-progress is never destroyed.
16. As a manga reader, I want opening an image for editing to carry over the existing translation bubbles and cleaned background, so that I don't have to re-clean or re-translate the page in the editor.
17. As a manga reader, I want edits made in the SuperK editor to remain draft-only until I explicitly choose to publish them, so that unfinished experiments do not prematurely alter my reading view.
18. As a manga reader, I want a "Send back to reading view" action in the SuperK editor, so that my completed edits update both the live overlay on the manga site and its saved local cache.
19. As a manga reader, I want the extension to warn me if the local SuperK service is not running, so that I know to start SuperK before requesting inpainting.
20. As a manga reader, I want translation to occur strictly on the single image I select, so that background processing does not overload my computer's RAM or exhaust my rate limits.

---

## Implementation Decisions

### Module Architecture & Seams

- **Local Integration Bridge Service**:
  - SuperK's local web application provides dedicated localhost endpoints (e.g. `/api/extension/settings`, `/api/extension/workspace/append`, `/api/extension/publish-back`).
  - Access is restricted to `127.0.0.1` and secured with origin checks to prevent unauthorized third-party site access.
- **Extension Background Worker Coordination**:
  - The extension background service worker handles network coordination, making requests to SuperK endpoints and the local OCR/cleaning service (port 8765).
  - Web page content scripts do not directly call raw TCP ports; all external communications pass through the background script.
- **Settings Synchronization Protocol**:
  - The extension fetches settings on demand from the local SuperK server with a short client-side memory cache (e.g., 30 seconds).
  - When SuperK is offline, the extension falls back to cached settings stored in extension local storage.
  - Settings changes made in SuperK take effect on the next translation request without mutating previously cached reading results.
- **Cleaning & Inpainting Pipeline**:
  - The extension extracts image data from the target `<img>` element (handling cross-origin images via background fetch or canvas capture).
  - Image bytes are dispatched to the local cleaning service (`/v1/jobs`), producing a clean background asset and mask.
  - If the cleaning service returns an error or is unreachable, the extension halts processing for that image, displays an actionable error badge with a retry action, and explicitly avoids falling back to opaque white boxes.
- **Shared Adaptive Text Fitting Engine**:
  - The core text layout algorithm (`fitTextInAdaptiveBubble`, font resolution, and line measurement) is structured so it can be packaged and consumed directly by the extension's content script.
  - The extension content script builds text overlays using standard canvas/DOM techniques identical to `translationOverlay.ts`, respecting text color, outline, font size multipliers, and vertical padding.
- **Workspace Handoff & Session Append Protocol**:
  - When the user clicks "Open in SuperK Editor", the extension transmits a handoff payload containing:
    - `pageUrl`: Source image URL and original image data
    - `cleanUrl`: Cleaned background image data
    - `bubbles`: Array of translated bubble objects with normalized bounding boxes and styling
    - `originUrl`: The URL of the web page where the manga was read
  - SuperK's backend appends this new page to the current `latest_session` in IndexedDB.
  - If a SuperK browser tab is already open, it receives a notification to refresh its active pages; if not, a new tab is opened focused on the newly appended page.
  - Concurrency between multiple editor tabs is safeguarded using atomic dirty-page tracking and session revision checks.
- **Bidirectional "Send Back to Reading View" Protocol**:
  - When editing an image originating from an external reading view, SuperK displays a prominent "Send to Reading View" action.
  - Clicking this action broadcasts the updated bubbles and rendered translation data back to the extension storage and active reading tab.
  - The content script on the manga site listens for this event, updates its live overlay DOM, and overwrites the cached reading record for that image.

---

## Testing Decisions

### What Makes a Good Test

Tests must verify observable external behavior and contracts rather than internal implementation details:
- When a reader translates an image, verify that the cleaning API is called, that the resulting overlay contains the translated text with correct styles, and that a failure presents an error badge without a white mask fallback.
- When an image is saved, verify that refreshing the page retrieves the saved overlay without invoking the translation API.
- When an image is sent to the editor, verify that existing workspace pages remain intact and the new page is appended with its translation intact.
- When edited in the workspace and sent back, verify that the reading cache receives the updated bubbles.

### Modules to Test

1. **Extension Bridge API**: Test `/api/extension/settings`, `/api/extension/workspace/append`, and `/api/extension/publish-back` for payload validation, session appending without truncation, and error handling.
2. **Extension Content Script Overlay**: Test DOM rendering of speech bubbles given mock translation data, verifying text containment, toggle between original and translated layers, and error badge states.
3. **Workspace Session Append Integration**: Test `projectStore.ts` to confirm that appending an external page to an existing 40+ page session preserves all existing pages, maintains bubble caches, and updates IndexedDB atomically.
4. **Cache & Persistence Mechanics**: Test local storage retention, retranslation invalidation, and explicit deletion of cached reading pages.

### Prior Art in Codebase

- `tests/translation/useTranslation.test.tsx` (Testing translation state transitions, dirty tracking, and session saving)
- `tests/cleaning/projectStore.test.ts` (Testing IndexedDB persistence, asset store integrity, and session restoration)
- `tests/translation/routes.test.ts` (Testing Next.js API endpoints and Gemini request delegation)
- `tests/unit/ovalTextFitting.test.ts` (Testing adaptive text fitting and bubble layout boundaries)

---

## Out of Scope

The following items are explicitly excluded from this release (per ADR `0001-extension-parity-scope.md`):

1. **Standalone Extension Operation**: Operating the extension when the local SuperK system is completely closed is not supported; SuperK must be running in the background.
2. **Whole-Page Auto-Discovery & Batch Translation**: Scanning entire web pages and automatically batch-translating dozens of images concurrently is deferred to preserve local RAM and API quotas.
3. **Full In-Browser Canvas Editor**: Replicating manual mask-painting brushes, polygon lasso tools, or PDF/CBZ export dialogs inside the extension popup or content script is out of scope.
4. **Independent Project Management in Extension**: Creating separate named projects or folders from within the extension; all imported pages append to the active SuperK workspace session.
5. **Automatic Bulk Retranslation on Settings Changes**: Automatically invalidating or re-translating existing cached reading results when a user modifies general settings in SuperK.

---

## Further Notes

- **Architecture Compliance**: Conforms directly to ADR `0001-extension-parity-scope.md`.
- **System Hardening Compatibility**: Builds upon the verified Phase R1-R3 fixes (dirty-page atomic snapshots, LRU asset retention, and event listener leak prevention).
- **Domain Vocabulary**: Uses standard project terminology: *speech bubbles, inpainting/cleaning, adaptive text fitting, workspace session, dirty set, reading overlay*.
