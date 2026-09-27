# Design Specification: Adaptive Stroke Dilation, Paragraph Gap Closing, and Compositor Feathering

- **Date:** 2026-09-27
- **Author:** Antigravity / SuperK Manga Translator Team
- **Status:** Draft / Ready for Review
- **Target Area:** `ocr-service` (mask refinement, compositor, pipeline routing)

---

## 1. Problem Statement & User Need

In manga and webtoons with stylized text (e.g. chromatic text with thick white strokes and dark drop shadows on colored artwork), the current cleaning engine leaves behind noticeable artifacts:
1. **Uncleaned Outer Stroke & Drop Shadow:** The text detector detects inner text glyphs, but because `_refine_seed_mask` strictly caps `dilation_radius = 1` px, the outer stroke and ambient drop shadow fall outside the mask. Since inpainting models (Anime-LaMa) only replace pixels inside the mask, these outer pixels remain untouched, creating a jagged residual contour.
2. **Stepped / Notched Paragraph Contours:** In multi-line paragraphs where trailing lines are shorter (e.g. a short final line like `teehee~♥♥`), the mask tightly hugs the letters, creating a sharp step-like indentation beneath the preceding lines. When inpainted, this notch forms a harsh boundary line across the background.
3. **Hard Boundary Seams:** In `compositor.py`, `compose()` uses `feather_radius = 0` (hard binary cut). Any microscopic difference in luminance, color, or noise texture between the inpainter output and the source image produces a visible 1px knife-edge seam.

---

## 2. Proposed Architecture & Solution (Approach 1)

We implement a three-tiered enhancement across the cleaning pipeline:

### 2.1 Component 1: Adaptive Stroke & Shadow Dilation (`ocr-service/app/mask_refiner.py`)
- **Current Behavior:**
  `radius = _estimate_stroke_radius(component)` is calculated (2 to 6 px) but ignored; `dilation_radius = 1` is hardcoded.
- **Enhanced Behavior:**
  - When dilating connected components in `_refine_seed_mask`, set `dilation_radius = max(2, min(5, radius + 1))`.
  - Growth remains strictly bounded by `constrained_dilate(..., protected_edges, dilation_radius)` and `grown[protected_edges > 0] = 0`. Character line art, faces, and scene boundaries detected by `build_protected_edges` remain 100% safeguarded.

### 2.2 Component 2: Paragraph Inter-Line Gap Closing (`ocr-service/app/mask_refiner.py`)
- **Current Behavior:**
  Components within a multi-line paragraph region retain harsh horizontal notches when one line is shorter than another.
- **Enhanced Behavior:**
  - For regions with multiple glyph components located inside a detected text envelope or evidence region, apply vertical and horizontal morphological closing with a small kernel (e.g. 5x5 or 7x7) bounded by `protected_edges` and `envelope`.
  - This fills jagged inter-glyph micro-cavities and rounds out trailing line steps, providing the inpainter with a cohesive, natural convex contour.

### 2.3 Component 3: Route-Aware Compositor Feathering (`ocr-service/app/compositor.py` & `pipeline.py`)
- **Current Behavior:**
  `compose(original, repaired, mask, feather_radius=0)` is called with no feathering.
- **Enhanced Behavior:**
  - Keep `compose(..., feather_radius=0)` as the default function signature for backward compatibility and unit tests.
  - In `pipeline.py`, route the feather radius according to `CleanerRoute`:
    - `CleanerRoute.FLAT`: `feather_radius = 0` (preserves razor-sharp crisp edges on pure solid speech bubbles).
    - `CleanerRoute.GRADIENT` and `CleanerRoute.ARTWORK`: `feather_radius = 2` (produces smooth Gaussian alpha blending across the boundary, dissolving seams into surrounding artwork).
  - The expanded `support` mask returned by `compose` matches the feathered area, ensuring `verify_damage` correctly evaluates `outside_changed == 0`.

---

## 3. Data Flow & Execution Sequence

```
Input Image + Text Probability
               │
               ▼
   build_protected_edges()  (Canny edges outside text zone)
               │
               ▼
    complete_glyph_mask()   (Fill + Outline candidate completion)
               │
               ▼
    _refine_seed_mask()
      ├─ Adaptive Dilation: dilation_radius = max(2, min(5, radius + 1))
      ├─ Constrained by protected_edges
      └─ Morphological gap closing for grouped paragraph components
               │
               ▼
     route_region()         (Classifies FLAT vs GRADIENT vs ARTWORK)
               │
               ▼
     cleaner.clean()        (Anime-LaMa / LaMa Large / Flat)
               │
               ▼
         compose()
      ├─ route == FLAT     → feather_radius = 0
      └─ route != FLAT     → feather_radius = 2
               │
               ▼
      verify_region()       (Residual and damage verification)
```

---

## 4. Error Handling & Edge Cases

1. **Text Adjacent to Line Art:**
   - If text touches character hair or an object border, `build_protected_edges()` protects those pixels. `constrained_dilate()` halts at `protected_edges > 0`, ensuring dilation never bleeds into adjacent drawings.
2. **Pure White Manga Speech Balloons (`CleanerRoute.FLAT`):**
   - Must not receive feathering (`feather_radius = 0`), preventing blurred edges along black balloon contours.
3. **Sparse SFX / Isolated Floating Characters:**
   - Isolated single glyphs (e.g. exclamation marks or small katakana) do not have neighboring paragraph lines, so gap closing is a no-op; only adaptive stroke dilation applies.

---

## 5. Verification & Testing Strategy (TDD)

### 5.1 Unit Tests (`pytest ocr-service/tests`)
1. **`test_adaptive_dilation_covers_stroke_and_shadow()`**:
   - Create a synthetic crop with text fill, 3px stroke, and 2px drop shadow on a gradient background.
   - Verify refined mask fully covers the stroke and shadow, but stops before an adjacent protected edge.
2. **`test_paragraph_gap_closing_smoothes_notched_step()`**:
   - Create a 2-line text cluster where line 1 is 100px wide and line 2 is 40px wide.
   - Verify the notch between line 1 and line 2 is bridged smoothly without leaving a sharp re-entrant corner.
3. **`test_route_aware_feathering_in_pipeline()`**:
   - Verify `FLAT` route executes with `feather_radius=0` while `ARTWORK` route executes with `feather_radius=2`.
   - Verify `verify_damage()` passes with `outside_changed == 0`.

### 5.2 Regression Gates
- **Pytest:** 189/189 existing tests must pass (+ new tests).
- **Vitest:** 959/959 Next.js / TypeScript tests must pass.
- **TypeScript & Lint:** `tsc --noEmit` 0 errors, ESLint 0 errors.
- **Real Manga Verification:** Verify on the user's sample page that the bottom seam and drop shadow are cleanly erased.

---

## 6. Success Criteria
- [ ] No dark jagged seams or residual drop-shadow outlines remain below multi-line text on artwork.
- [ ] White dialogue balloons remain crisp with zero blurring.
- [ ] All CI test suites pass with 100% green status.
