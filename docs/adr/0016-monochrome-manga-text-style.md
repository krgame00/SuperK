# 0016. Authentic Monochrome Manga Text Style

Date: 2026-09-17

## Status

Accepted — Shared Understanding confirmed on 2026-09-17. This ADR provides a narrow supersession of ADR 0015 specifically for confirmed monochrome manga pages. Full-color pages, unknown confidence pages, manual styling, and special categories (SFX / overlay subtitle) continue under their existing policies.

## Context

Under ADR 0015, all automatically translated text received a uniform dark drop shadow (`STANDARD_TRANSLATED_TEXT_SHADOW`). While this established consistency on color manga artwork, it produced an artificial, non-traditional look on standard black-and-white (monochrome) manga pages:
- In traditional monochrome manga, speech dialogue inside white balloons consists of crisp black text (`#000000`) without an artificial drop shadow.
- Inverted dialogue in black or dark speech bubbles consists of crisp white text (`#ffffff`) without a drop shadow.
- Speech over complex screentones or mixed gray artwork uses a contrasting outline for readability, but still avoids artificial decorative drop shadows.

We need a dedicated, deterministic policy that detects monochrome manga pages and applies authentic styling while preserving ADR 0015 uniform shadows on color pages and ensuring exact parity across Web Preview, Export, and Chrome Extension.

## Decision

1. **Confirmed monochrome pages are a narrow exception to ADR 0015.**
   When the source page is classified as monochrome with high confidence (`isMonochromePage === true` and `monochromeConfidence >= 0.85`), dialogue and narration do not receive the automatic ADR 0015 drop shadow (`shadow = undefined`).

2. **Automatic monochrome styling applies strictly to `dialogue` and `narration`.**
   Special text categories retain their established behavior:
   - `sfx` (sound effects): Retains admitted source styles and effects without monochrome suppression.
   - `overlay_subtitle`: Retains existing contrast validation, outline strengthening, and background plate escalation under ADR 0008/0012.

3. **White / light speech balloons render crisp black text without shadow.**
   When `backgroundLuminance >= 155` and the region is not mixed:
   - `textColor`: `#000000`
   - `hasOutline`: `false` (unless high-confidence admitted source outline is present)
   - `shadow`: `undefined`
   - `glow`: `undefined`

4. **Black / dark bubbles render crisp white text without shadow.**
   When `backgroundLuminance <= 100` and the region is not mixed:
   - `textColor`: `#ffffff`
   - `hasOutline`: `false` (unless high-confidence admitted source outline is present)
   - `shadow`: `undefined`
   - `glow`: `undefined`

5. **Mixed / intermediate backgrounds use contrasting outline without drop shadow.**
   When `100 < backgroundLuminance < 155` or when background luminance samples indicate a mixed region (delta >= 90):
   - Contrast luminance selects black or white text.
   - Contrasting outline is enabled (`0.10–0.14` font-size ratio).
   - `shadow`: `undefined`.

6. **Manual styling retains absolute authority.**
   User-authored manual styling (`ownershipMode === 'manual'` or `source === 'manual'`) is never overridden by monochrome page classification. `manualShadowMode: 'standard'` produces the standard shadow, and `manualShadowMode: 'off'` produces no shadow.

7. **Color and unconfirmed pages preserve ADR 0015 Uniform Shadow.**
   If the classifier determines the page has meaningful color, or if confidence is below 0.85, or if classification fails, the page falls back completely to ADR 0015 `STANDARD_TRANSLATED_TEXT_SHADOW`.

8. **Page classification uses the original pre-clean source image only.**
   Classification MUST run on the pre-clean source image bytes before inpainting or cleaning. A text-removal mask or cleaned image must never be used for classification, as cleaning can artificially turn color artwork gray or white.

9. **Deterministic, whole-page classification.**
   Classification is evaluated once per page using deterministic grid subsampling (up to ~20,000 samples) to prevent high-resolution scan lag, and is evaluated at the page level so white speech balloons on color pages are not misclassified as monochrome.

10. **Full rendering parity across Web Preview, Export, and Chrome Extension.**
    The resolver is the single authority for text style. Web Preview Canvas, Image Export, Extension Server Mode, Extension Direct Mode, and restored local-storage caches all produce identical monochrome text styles.

## Consequences

- Standard black-and-white manga pages render authentic, native manga text without artificial digital drop shadows.
- White speech balloons display clean black text (`#000000`), and dark bubbles display clean white text (`#ffffff`).
- Full-color manga pages continue to benefit from ADR 0015 uniform drop shadows for legibility.
- No user-facing mode toggles are required; detection is automatic and deterministic.
- Legacy project metadata and source color detection evidence remain fully intact for future inspection.
