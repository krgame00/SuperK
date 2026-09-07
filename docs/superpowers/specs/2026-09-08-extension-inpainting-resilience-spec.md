# Extension Inpainting Pipeline & Fail-Loud Resilience

Status: ready-for-agent
Triage: ready-for-agent
Domain Glossary: CONTEXT.md
Reference: docs/adr/0001-extension-parity-scope.md

---

## Problem Statement

When manga readers trigger the SuperK Chrome Extension to translate a manga page in the reading view, the Thai translated dialogue is rendered directly on top of the original Japanese or English text. This happens because the underlying inpainting pipeline either fails to download the cleaned artwork asset or silently swallows errors when inpainting fails.

From the reader's perspective:
1. The manga page becomes unreadable and messy because translated Thai dialogue is overlaid directly over the original speech, creating illegible, overlapping text artifacts.
2. The reader receives no feedback or error notification explaining that inpainting failed—the extension deceptively reports a successful translation even though the original dialogue was never erased.
3. The extension settings popup previously lacked an option for AI inpainting, causing any saved settings to force the cleaning mode into flat solid white rectangles or uncleaned stroke text.
4. When reading in direct Gemini API mode without a local SuperK server running, the extension would attempt to invoke non-existent local inpainting endpoints and fail or hang.

---

## Solution

Ensure that the Chrome Extension reading view reliably renders the inpainted clean background underneath translated dialogue by:
1. Normalizing the cleaner asset URLs through the local Next.js proxy route (`/api/clean/v1/jobs/...`) so that asset downloads succeed with HTTP 200 instead of failing with HTTP 404.
2. Enforcing a strict fail-loud invariant: if inpainting is requested but fails, or if the returned clean image base64 data is empty, the flow immediately aborts and displays an actionable error badge with a retry button on the target image, strictly forbidding rendering text over uncleaned original artwork or crude white boxes.
3. Updating the extension popup interface and configuration storage to expose and default to AI inpainting, synchronizing cleanMode preferences directly with the running SuperK server.
4. Isolating direct Gemini API mode so that readers translating without a local SuperK engine proceed smoothly without triggering invalid cleaner job requests.

---

## User Stories

1. As a manga reader in the reading view, I want original dialogue text to be cleanly erased using the inpainted clean background, so that I can read the translated dialogue clearly without overlapping original text.
2. As a manga reader, I want the extension background worker to download cleaned image assets through the unified Next.js proxy route, so that asset retrieval never fails with 404 errors due to route mismatches.
3. As a manga reader, I want the translation process to fail loudly with a descriptive error message if the inpainting engine returns an empty or invalid cleaned image, so that I am never presented with false success where text is placed over uncleaned artwork.
4. As a manga reader, I want an actionable retry badge to appear on the manga image when inpainting encounters a temporary failure, so that I can re-attempt inpainting with a single click.
5. As a manga reader, I want the inpainting pipeline to strictly avoid falling back to opaque white boxes when inpainting fails, so that the visual integrity of the manga is preserved.
6. As a manga reader, I want the extension popup to display "Inpainting (Recommended)" as the default cleaning mode, so that I benefit from AI background restoration out of the box.
7. As a manga reader, I want my cleanMode preference to automatically synchronize from the SuperK server settings, so that changes made in the SuperK workspace reflect consistently in my browser extension.
8. As a manga reader, I want the extension to remember my chosen cleanMode (inpainting, solid, stroke) across browser sessions, so that I do not have to reconfigure my preferences each time I open Chrome.
9. As a manga reader using direct Gemini API mode without a running SuperK server, I want translation to succeed directly with Gemini without attempting to reach the local inpainting backend, so that the extension works independently without throwing connection errors.
10. As a manga reader, I want the extension to correctly handle offline server states by safely falling back to stored extension preferences rather than failing with undefined setting errors.
11. As a manga reader, I want high-resolution SuperK branding icons in the extension toolbar, so that I can easily locate and launch the extension popup.
12. As a manga reader, I want the cleaned background image to render at the exact pixel dimensions and aspect ratio of the original manga panel, so that speech bubbles and art align seamlessly.
13. As a manga reader, I want the inpainting job polling mechanism to time out gracefully after 30 seconds if the backend hangs, so that my browser does not consume resources in an infinite polling loop.
14. As a manga reader, I want the extension to validate that cleaner job responses contain valid job identifiers before starting polling, so that malformed server responses fail immediately.
15. As a manga reader, I want translated speech bubbles to maintain adaptive text fitting on top of the inpainted clean background, so that dialogue fits naturally within speech bubbles.

---

## Implementation Decisions

1. **Proxy URL Normalization for Cleaner Assets**:
   The inpainting engine returns relative clean asset paths (e.g. `/v1/jobs/{jobId}/assets/clean.png`). The extension routes all server requests through the primary SuperK port (`http://127.0.0.1:3000`). The client-side server module inspects the asset path; if it begins with `/v1/` and does not already include `/api/clean`, it normalizes the URL to `${base}/api/clean${cleanAssetPath}` before fetching.

2. **Strict Invariant: Fail-Loud on Missing Inpainted Clean Background**:
   Under `cleanMode: "inpainting"`, the extension requires a non-empty `cleanImageBase64` string. If the asset HTTP fetch fails or the decoded payload is empty, the flow throws an explicit error (`Error: ไม่ได้รับข้อมูลภาพ cleanImageBase64 จากระบบ Inpainting`) and dispatches a `TRANSLATION_ERROR` action. Silent fallbacks that render text over uncleaned dialogue are forbidden.

3. **Extension Configuration Hierarchy & Default Alignment**:
   `popup.html` and `popup.js` include `inpainting` as the recommended default alongside `solid` and `stroke`. The background script resolves settings by prioritizing online `synced.cleanMode` from the SuperK server, falling back to local `stored.cleanMode` when offline or when using local overrides.

4. **Direct Translation Mode Isolation**:
   When `translationMode` is set to `"direct"`, the extension does not query the local SuperK server for settings and does not invoke the local inpainting pipeline, preventing spurious network connection errors when the SuperK server is not active.

5. **DOM Clean Image Insertion Invariant**:
   In the reading view content script, the inpainted clean background is inserted into the DOM as an `<img>` tag with class `.superk-clean-image` situated behind all speech bubble overlays and styled with matching dimensions and pointer-events disabled.

---

## Testing Decisions

- **Test Seam**: The tests operate at the highest available seam: the extension background execution context (`runTranslationFlow`) and the cleaner pipeline service client (`SuperKServer.inpaintImage()`).
- **External Behavior Verification**:
  - Verify that `SuperKServer.inpaintImage()` successfully posts jobs, polls status, fetches clean assets via the normalized `/api/clean/` route, and returns base64 PNG data.
  - Verify that when the clean asset returns HTTP 404 or fails, the pipeline throws a descriptive error and dispatches `TRANSLATION_ERROR` with retry capability rather than rendering text over uncleaned artwork.
  - Verify that direct translation mode bypasses server inpainting and delivers Gemini translations directly.
  - Verify that offline server conditions preserve stored user cleanMode settings.
- **Prior Art**:
  - `tests/chrome-extension/inpaintingPipeline.test.ts`
  - `tests/chrome-extension/runtime.test.ts`
  - `tests/chrome-extension/settingsSync.test.ts`

---

## Out of Scope

- Client-side WebAssembly inpainting (all inpainting is executed by the local Python FastAPI backend).
- Inpainting support for standalone Direct Gemini mode without a running SuperK backend.
- Manual interactive mask painting tools inside the Chrome extension reading view (detailed mask editing is handled via handoff to the full SuperK translation workspace).

---

## Further Notes

- Inpainted clean background assets are cached alongside translation bubbles so that switching between original and translated view does not re-trigger cleaning.
- All 79 test suites (362 tests) across the SuperK repository pass with 100% success rate following these changes.
