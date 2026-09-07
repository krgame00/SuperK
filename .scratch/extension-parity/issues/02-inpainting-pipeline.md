# 02: Inpainting Pipeline & Actionable Error Recovery

**What to build:** The extension processes manga images using the local SuperK inpainting engine (`127.0.0.1:8765/v1/jobs`) to cleanly remove original dialogue text while preserving screentones, line art, and background artwork, completely replacing flat white box masking. If the inpainting engine encounters an error or is unreachable, the extension halts processing and renders an actionable error badge with a "Retry" button on the image, strictly forbidding opaque white fallback rectangles.

**Blocked by:** 01: Settings Synchronization Bridge

**Status:** done

- [x] Extension background worker dispatches target image to local cleaning service (`127.0.0.1:8765/v1/jobs`).
- [x] Content script renders the returned inpainted background image as the base layer under translated dialogue.
- [x] Inpainting failure or offline backend renders a clear, non-intrusive error badge on the image with a functional "Retry" button.
- [x] Crude white mask rectangle code is removed or prevented from activating during normal cleaning failures.
- [x] Integration tests verify successful inpainting flow and error state rendering with mock cleaning service responses.
- [x] Inpainting asset proxy path resolution and fail-loud invariant specified in [docs/superpowers/specs/2026-09-08-extension-inpainting-resilience-spec.md](file:///c:/Users/PC/Downloads/manga-translator/docs/superpowers/specs/2026-09-08-extension-inpainting-resilience-spec.md).
