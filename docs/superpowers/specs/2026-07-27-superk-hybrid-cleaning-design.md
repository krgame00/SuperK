# SuperK Hybrid Manga Text Cleaning Design

- **Date:** 2026-07-27
- **Status:** Approved design
- **Target:** SuperK web upload workflow
- **Runtime constraint:** Local-only, no paid API, CPU-first on AMD Ryzen 5 5600G with 31 GB RAM
- **Performance target:** Median 20–30 seconds per page, with quality preferred over a hard timeout

## 1. Problem

SuperK currently derives broad regions from OCR or vision-model bounding boxes and cleans them with brightness thresholds, OpenCV inpainting, or solid white overlays. This produces visible rectangular or colored patches, removes nearby artwork, and performs poorly on floating text, outlined text, colored text, and text drawn over characters.

The cleaning system must remove the shapes of the source glyphs rather than erase an entire text bounding box. It must use a deterministic reconstruction method for simple speech-bubble interiors and reserve learned inpainting for artwork or textured backgrounds.

## 2. Goals

- Produce a clean image layer without painting white rectangles or color patches over the source.
- Create pixel-level text masks independent of Gemini bounding-box accuracy.
- Preserve bubble borders, character line art, screentones, gradients, and surrounding pixels.
- Run locally without a paid API or recurring service cost.
- Finish a typical page in 20–30 seconds on the target CPU.
- Allow region-level inspection, correction, retry, undo, and caching.
- Keep translation text as a separate editable layer until export.
- Detect residual source text and retry only the affected regions.

## 3. Non-goals

- Replacing the existing translation model or translation prompt.
- Translating or redrawing the entire page with a generative image model.
- Guaranteeing that every highly stylized SFX can be removed automatically.
- Making the Chrome extension use the new pipeline in the first implementation.
- Providing a hosted GPU service.

## 4. Selected Approach

Use a hybrid, region-routed pipeline:

1. Detect text and produce a pixel-level segmentation mask.
2. Refine the mask according to glyph stroke width and nearby line art.
3. Group nearby mask components into repair regions.
4. Classify each region as flat, gradient, or artwork.
5. Apply the least destructive cleaner that fits the region.
6. Blend the repaired pixels back through the refined mask.
7. Verify residual text and collateral damage.
8. Retry or flag only uncertain regions.

The first detector candidate is `comic-text-detector` exported to ONNX and executed with ONNX Runtime on CPU. The artwork cleaner candidate is a manga/anime-tuned LaMa checkpoint (`lama-manga`). AOT inpainting remains a benchmark alternative, not a simultaneous production dependency.

## 5. Architecture

### 5.1 Web application

The existing Next.js application remains responsible for:

- Image and document upload
- Page navigation
- Starting and monitoring cleaning jobs
- Displaying original, clean, and mask layers
- Manual mask correction and region retry
- Translation editing and typesetting
- Final export

`lib/translationOverlay.ts` must stop producing a cleaning mask or painting a fallback background. It will render translated text over the clean image returned by the local service.

### 5.2 Local vision service

The existing `ocr-service` directory becomes the local vision service. New production code belongs under `ocr-service/app/`; the local virtual environment must remain untracked.

Proposed modules:

- `api.py`: FastAPI endpoints, validation, job lifecycle, and health checks
- `pipeline.py`: Orchestrates one page-cleaning job
- `detector.py`: ONNX text detection and segmentation
- `mask_refiner.py`: Component filtering, stroke-aware dilation, and border protection
- `region_router.py`: Flat, gradient, or artwork classification
- `cleaners/flat.py`: Robust local-color reconstruction
- `cleaners/opencv.py`: Edge-aware OpenCV inpainting candidates
- `cleaners/lama.py`: Crop-based manga LaMa inference
- `compositor.py`: Feathered region composition
- `verifier.py`: Residual-text and collateral-damage checks
- `cache.py`: Content-addressed job and model-result cache
- `schemas.py`: Typed request, result, region, and diagnostic records

Each module has one responsibility and communicates with typed image arrays, masks, and region records. Model-specific code stays behind detector and cleaner interfaces so that checkpoints can be benchmarked or replaced without changing the web contract.

### 5.3 Job API

Cleaning is asynchronous so a slow page does not hold a Next.js request open.

- `GET /v1/health`
  - Reports service readiness, model availability, runtime providers, and version.
- `POST /v1/jobs`
  - Accepts one image plus cleaning settings.
  - Returns a `job_id`, source hash, and initial status.
- `GET /v1/jobs/{job_id}`
  - Returns status, stage, elapsed time, region progress, warnings, and errors.
- `GET /v1/jobs/{job_id}/result`
  - Returns the clean image, combined mask, region metadata, timings, and verification report.
- `POST /v1/jobs/{job_id}/regions/{region_id}/retry`
  - Accepts an edited mask and optional cleaner override.
  - Reprocesses only the selected region.

The Next.js API layer proxies these endpoints so the browser does not need direct cross-origin access to a localhost port.

## 6. Data Flow

1. The web application hashes and uploads the original page.
2. The local service normalizes orientation and color format while retaining original dimensions.
3. The detector produces text blocks, line polygons, confidence values, and a pixel mask.
4. OCR or Gemini boxes may guide the search area but never become the deletion mask.
5. The mask refiner removes noise, measures stroke width, dilates glyphs, and prevents crossing protected edges.
6. Nearby components are grouped into repair regions.
7. The router assigns a cleaner and confidence to every region.
8. The chosen cleaner reconstructs only the masked pixels, using a context crop where required.
9. The compositor blends the repair result into the original page.
10. The verifier looks for residual glyph evidence and unexpected changes.
11. Failed verification triggers one bounded region retry; a second failure keeps the original pixels and marks the region for review.
12. The service returns the clean image and diagnostics.
13. SuperK renders translated text as a separate editable layer.

## 7. Mask Generation and Refinement

### 7.1 Detector output

The detector must provide a pixel-level probability mask in addition to text boxes. Bounding boxes alone are insufficient for deletion.

### 7.2 Component filtering

Connected components are filtered using:

- Detector confidence
- Minimum and maximum component area relative to page size
- Stroke width consistency
- Proximity to a detected text line or OCR box
- Shape evidence expected from glyphs

This replaces the current global light/dark pixel threshold, which incorrectly selects skin highlights, white clothing, hair, and bubble interiors.

### 7.3 Stroke-aware dilation

The binary mask is expanded according to estimated glyph stroke width, normally by 2–4 pixels at the source resolution. Expansion is morphological and follows glyph contours; it never becomes a filled text rectangle.

Outlined or shadowed glyphs receive an additional ring discovered from local color and edge continuity. Dilation parameters are recorded per region for reproducibility and retry.

### 7.4 Protected edges

Strong edges that form bubble borders, panel borders, or nearby character line art become protected edges. Mask growth stops at a protected edge unless the detector has high-confidence glyph evidence on both sides.

### 7.5 Region grouping

Components are grouped by line membership, distance, orientation, and shared background. Nearby artwork regions may share a single context crop, but their final blend masks remain separate.

## 8. Region Routing

The router calculates features in a ring around each mask:

- Robust color variance in Lab space
- Gradient magnitude and direction
- Edge density and edge continuity
- Local entropy and texture energy
- Proximity to bubble and panel borders
- Fraction of the region covered by line art

It assigns one of three routes:

### 8.1 `FLAT`

For white, colored, or nearly uniform bubble interiors.

- Estimate the background using robust median or clustered ring colors.
- Reconstruct gentle gradients when a single color is insufficient.
- Blend through a narrow edge-aware feather.
- Do not invoke a neural inpainting model.

### 8.2 `GRADIENT`

For gradients, screentones, and light texture.

- Run bounded OpenCV Telea candidates using several radii.
- Score candidates for boundary continuity, texture consistency, and seam visibility.
- Select the best candidate rather than relying on one global radius.

### 8.3 `ARTWORK`

For text over characters, clothing, detailed scenery, or dense SFX.

- Add 64–128 source pixels of context around the mask.
- Resize only when necessary, preserving aspect ratio and mapping coordinates exactly.
- Run `lama-manga` on a 512–768 pixel crop.
- Merge nearby artwork regions when sharing context reduces inference cost.
- Composite back only through the refined mask and feather ring.

## 9. Performance Strategy

The 20–30 second target is a median quality target, not a destructive hard cutoff.

Expected CPU budget for a typical page:

- Decode and normalization: under 1 second
- ONNX detection and segmentation: 4–8 seconds
- Mask refinement and routing: 1–3 seconds
- Flat and gradient cleaning: 1–4 seconds
- Batched artwork crops: 8–16 seconds
- Verification and encoding: 2–4 seconds

The pipeline avoids full-page neural inpainting. It batches nearby artwork crops and caches intermediate detector, mask, and cleaner outputs by source hash, model version, and settings. Region retry must not rerun detection or unrelated cleaners.

Pages with unusually dense artwork text may exceed 30 seconds. The UI reports the current stage and elapsed time instead of canceling a quality pass.

## 10. Verification and Safety

### 10.1 Residual text

The verifier combines:

- Detector probability remaining inside the original text region
- OCR evidence where OCR supports the source script
- Stroke-like connected components inside the repaired mask

If the residual score exceeds the configured threshold, the system expands that region's mask and retries once.

### 10.2 Collateral damage

- Pixels outside the repair mask plus feather support must remain byte-identical to the source.
- Boundary-gradient discontinuity and abnormal color change are measured per region.
- A repair that exceeds the damage threshold is rejected.
- Rejected regions retain their original pixels and are marked `needs_review`.

### 10.3 Failure isolation

- A detector failure may fall back to OCR or Gemini boxes as search regions, followed by local mask generation.
- A LaMa failure falls back to the best OpenCV candidate for that region.
- One failed region does not fail the page.
- A service failure leaves the original page and editable translation state intact.
- Errors include stage, region, model, elapsed time, and a user-facing recovery action.

## 11. Web Editing Experience

The page editor exposes three toggleable layers:

- `Original`
- `Clean`
- `Mask`

The mask layer colors regions by route and shows confidence and verification status. For a selected region, the user can:

- Paint into or erase from the mask
- Select `Auto`, `Flat`, `OpenCV`, or `LaMa`
- Retry only that region
- Hold to compare before and after
- Undo or redo edits and retries

The clean image is the actual background layer. Translation text remains a separate layer until export. The web renderer must not add a white cleaning canvas or a background patch behind translated text.

## 12. Caching and Reproducibility

The cache key includes:

- SHA-256 of original image bytes
- Detector and cleaner model identifiers
- Model file hashes
- Pipeline version
- Mask and routing settings

Each result stores:

- Clean image
- Combined mask
- Region crops and masks
- Route and confidence per region
- Retry history
- Timings
- Verification report

Manual edits create a derived result without overwriting the original automatic result.

## 13. Benchmark Dataset

The primary benchmark source is `F:\Doujin\Download`, which currently contains 881 unpacked images: 474 WebP, 334 JPG, and 73 PNG.

The benchmark manifest selects 30 representative source pages. Folders explicitly tagged as translated, including `[English]`, `[Chinese]`, `[Thai]`, `ภาษาไทย`, or `[中国翻訳]`, are excluded from the primary set.

The selection must include:

- White and colored speech bubbles
- Vertical Japanese text
- Outlined and colored glyphs
- Floating SFX over artwork
- Monochrome screentones
- Complex color backgrounds
- Dense text pages
- Text-free pages

The benchmark manifest stores relative identifiers, file hashes, dimensions, and category labels. Source images are not copied into or committed to the repository.

`E:\SuperK\SuperK_Page_001_1.webp` and `E:\SuperK\SuperK_Page_001_2.webp` remain regression references for the previously observed colored-patch failure, but they are not primary benchmark inputs.

## 14. Acceptance Criteria

- No rectangular white or colored cleaning patches are visible.
- No source text is detected above the agreed residual threshold in at least 95% of benchmark text regions.
- At least 90% of regions pass without manual mask correction.
- Bubble borders and protected artwork edges remain continuous.
- Pixels outside repair-mask support remain byte-identical to the source.
- Text-free pages are returned pixel-identical after lossless processing.
- Median end-to-end time is at most 30 seconds on the target machine after models are loaded.
- A failed or uncertain repair preserves the original region and reports `needs_review`.
- The two `E:\SuperK` regression pages do not reproduce the broad colored-patch defect.
- Upload, cleaning, layer inspection, region retry, typesetting, and export complete in an integration test.

## 15. Test Strategy

### Unit tests

- Component filtering
- Stroke-width estimation and mask dilation
- Protected-edge behavior
- Region grouping and crop-coordinate round trips
- Route feature calculation and classification
- Cache-key stability
- Composite invariants outside mask support

### Golden tests

- Approved refined masks for representative page crops
- Approved flat, gradient, and artwork repair outputs
- Pixel-diff tolerances limited to mask and feather support

### Integration tests

- Upload through completed clean result
- Progress reporting
- Cache hit
- Region-level edited-mask retry
- Detector, OpenCV, and LaMa fallback paths
- Translation overlay and export using the clean image layer

### Performance tests

Record warm and cold model-load times separately. Report detector, routing, cleaner, verification, encoding, and total time. Acceptance uses warm median page time because model loading occurs once per service session.

## 16. Model and License Constraints

The cleaning runtime must remain free and usable offline after initial model installation. Model weights and dependencies require a license review before distributing SuperK to other users. GPL components must not be copied into a differently licensed distribution without satisfying their terms. The implementation plan must record the chosen checkpoint, source URL, checksum, license, and redistribution decision.

## 17. References

- [comic-text-detector](https://github.com/dmMaze/comic-text-detector)
- [manga-image-translator](https://github.com/zyddnys/manga-image-translator)
- [comic-translate](https://github.com/ogkalu2/comic-translate)
- [IOPaint](https://www.iopaint.com/)
