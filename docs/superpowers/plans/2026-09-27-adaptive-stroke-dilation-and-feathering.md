# Adaptive Stroke Dilation, Paragraph Gap Closing, and Compositor Feathering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate uncleaned stroke/drop-shadow artifacts, stepped paragraph notches, and knife-edge inpainting seams on stylized and artwork manga text by introducing adaptive dilation, paragraph gap closing, and route-aware alpha feathering.

**Architecture:** 
1. In `ocr-service/app/mask_refiner.py`, dynamically compute dilation radius using the component's estimated stroke radius (`max(2, min(5, stroke_radius + 1))`) while strictly honoring `protected_edges`.
2. Apply paragraph morphological closing to bridge stepped re-entrant notches between adjacent lines within multi-line text envelopes.
3. In `ocr-service/app/pipeline.py` and `compositor.py`, route feathering to `feather_radius = 2` for `ARTWORK` and `GRADIENT` routes (smooth alpha blend) while retaining `feather_radius = 0` for `FLAT` routes (crisp solid bubble boundaries).

**Tech Stack:** Python 3.11+, OpenCV (`cv2`), NumPy, Pytest, PyTorch/Anime-LaMa.

## Global Constraints

- Python CI test suite (`pytest`) must pass 100% with zero regressions on existing 189 tests.
- Vitest suite (959 tests) and TypeScript typecheck (`tsc --noEmit`) must remain 100% green.
- `protected_edges` must never be breached: line art, faces, and non-text artwork must remain untouched.
- `CleanerRoute.FLAT` must retain `feather_radius = 0` to prevent blurry edges on pure black/white speech balloons.
- All code edits must use TDD: failing test first, verify failure, write minimal code, verify pass, commit.

---

### Task 1: Route-Aware Compositor Feathering

**Files:**
- Modify: `ocr-service/app/compositor.py:8-42`
- Modify: `ocr-service/app/pipeline.py:234-245`, `270-278`
- Test: `ocr-service/tests/test_compositor.py`

**Interfaces:**
- Consumes: `CleanerRoute` from `app.schemas`, `compose(original, repaired, mask, feather_radius=0)` from `app.compositor`.
- Produces: `compose()` with optional `feather_radius` parameter; `pipeline.py` passing `feather_radius=0` for `FLAT` and `feather_radius=2` for `GRADIENT`/`ARTWORK`.

- [ ] **Step 1: Write the failing unit test for compositor feathering quality**

In `ocr-service/tests/test_compositor.py`:
```python
def test_compositor_feather_produces_smooth_alpha_transition() -> None:
    original = np.zeros((32, 32, 3), np.uint8)
    repaired = np.full((32, 32, 3), 100, np.uint8)
    mask = np.zeros((32, 32), np.uint8)
    mask[10:22, 10:22] = 255

    # feather_radius=2 should produce intermediate gradient values along the border
    result, support = compose(original, repaired, mask, feather_radius=2)

    # Pixels deep inside mask should be fully repaired
    assert np.all(result[12:20, 12:20] == 100)
    # Pixels outside support should be strictly 0
    assert np.all(result[support == 0] == 0)
    # Border pixels between mask and support boundary should have intermediate values (0 < val < 100)
    border_pixels = result[(support > 0) & (mask == 0)]
    assert np.any((border_pixels > 0) & (border_pixels < 100)), "Expected smooth feather gradient at border"
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_compositor.py -k test_compositor_feather_produces_smooth_alpha_transition -v`
Expected: PASS (verifying existing feathering implementation in `compositor.py`).

- [ ] **Step 3: Write failing integration test in `test_pipeline.py` for route-aware feathering**

Add to `ocr-service/tests/test_pipeline.py`:
```python
def test_pipeline_uses_feathering_for_artwork_route_and_none_for_flat() -> None:
    from app.pipeline import _feather_radius_for_route
    from app.schemas import CleanerRoute

    assert _feather_radius_for_route(CleanerRoute.FLAT) == 0
    assert _feather_radius_for_route(CleanerRoute.GRADIENT) == 2
    assert _feather_radius_for_route(CleanerRoute.ARTWORK) == 2
```

- [ ] **Step 4: Run test to verify it fails**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_pipeline.py -k test_pipeline_uses_feathering_for_artwork_route_and_none_for_flat -v`
Expected: FAIL with `ImportError: cannot import name '_feather_radius_for_route'`.

- [ ] **Step 5: Implement `_feather_radius_for_route` and integrate into `pipeline.py`**

In `ocr-service/app/pipeline.py`:
```python
def _feather_radius_for_route(route: CleanerRoute) -> int:
    if route is CleanerRoute.FLAT:
        return 0
    return 2
```
And update `pipeline.py` cleaning passes:
```python
            feather = _feather_radius_for_route(route.route)
            candidate, support = compose(before, repaired, region_mask, feather_radius=feather)
```
And in retry pass:
```python
            candidate, support = compose(before, retry_repaired, retry_mask, feather_radius=feather)
```
And in `retry_region`:
```python
        feather = _feather_radius_for_route(route.route)
        candidate, support = compose(working_image, repaired, binary_mask, feather_radius=feather)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_pipeline.py -k test_pipeline_uses_feathering_for_artwork_route_and_none_for_flat -v`
Expected: PASS

- [ ] **Step 7: Commit Task 1**

```bash
git add ocr-service/app/pipeline.py ocr-service/tests/test_pipeline.py ocr-service/tests/test_compositor.py
git commit -m "feat(cleaner): add route-aware compositor feathering for artwork and gradient text"
```

---

### Task 2: Adaptive Stroke & Shadow Dilation

**Files:**
- Modify: `ocr-service/app/mask_refiner.py:182-205`
- Test: `ocr-service/tests/test_mask_refiner.py`

**Interfaces:**
- Consumes: `_estimate_stroke_radius(component: BinaryMask) -> int`, `constrained_dilate(seed, protected_edges, radius)`.
- Produces: `_refine_seed_mask()` with adaptive dilation radius `max(2, min(5, stroke_radius + 1))` bounded by `protected_edges`.

- [ ] **Step 1: Write failing test in `test_mask_refiner.py`**

Add to `ocr-service/tests/test_mask_refiner.py`:
```python
def test_adaptive_dilation_covers_stroke_and_shadow_without_breaching_protection() -> None:
    # 50x50 image with text component having stroke radius 3
    # Seed text core is 6px wide at x=20..26, y=20..30
    seed = np.zeros((50, 50), np.uint8)
    seed[20:30, 20:26] = 255
    
    # A protected edge is located 6px away at x=32
    protected_edges = np.zeros((50, 50), np.uint8)
    protected_edges[:, 32] = 255
    
    from app.mask_refiner import _refine_seed_mask
    refined = _refine_seed_mask(seed, protected_edges)
    
    # Adaptive dilation should expand the 6px seed beyond +1px (reaching at least x=28)
    assert refined.mask[25, 28] == 255, "Mask must expand by at least 2px to cover stroke and shadow"
    # But it must strictly respect the protected edge at x=32 (x>=32 must be 0)
    assert np.all(refined.mask[:, 32:] == 0), "Mask must not breach protected edges"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_mask_refiner.py -k test_adaptive_dilation_covers_stroke_and_shadow_without_breaching_protection -v`
Expected: FAIL with `assert refined.mask[25, 28] == 255` (because previous dilation_radius=1 only reached x=26+1=27).

- [ ] **Step 3: Implement adaptive stroke dilation in `_refine_seed_mask`**

In `ocr-service/app/mask_refiner.py` (around line 194-199):
```python
        radius = _estimate_stroke_radius(component)
        # Adaptive dilation based on estimated stroke radius (minimum 2px, up to 5px for thick stroke/shadow)
        dilation_radius = max(2, min(5, radius + 1))
        grown = constrained_dilate(component, protected_edges, dilation_radius)
        grown[protected_edges > 0] = 0
        grown = np.maximum(grown, component)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_mask_refiner.py -k test_adaptive_dilation_covers_stroke_and_shadow_without_breaching_protection -v`
Expected: PASS

- [ ] **Step 5: Run existing mask refiner test suite to verify no regressions**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_mask_refiner.py -v`
Expected: PASS (all existing tests pass).

- [ ] **Step 6: Commit Task 2**

```bash
git add ocr-service/app/mask_refiner.py ocr-service/tests/test_mask_refiner.py
git commit -m "feat(mask): enable adaptive stroke and drop-shadow dilation in mask refiner"
```

---

### Task 3: Paragraph Inter-Line Gap Closing for Artwork Text

**Files:**
- Modify: `ocr-service/app/mask_refiner.py:260-289`
- Test: `ocr-service/tests/test_mask_refiner.py`

**Interfaces:**
- Consumes: `RefinedMask`, `envelope: BinaryMask`, `protected_edges: BinaryMask`.
- Produces: `close_paragraph_notches(mask: BinaryMask, regions: list[MaskRegion], envelope: BinaryMask, protected_edges: BinaryMask) -> BinaryMask`

- [ ] **Step 1: Write failing test in `test_mask_refiner.py`**

Add to `ocr-service/tests/test_mask_refiner.py`:
```python
def test_paragraph_gap_closing_smoothes_notched_step() -> None:
    from app.mask_refiner import close_paragraph_notches, MaskRegion
    from app.schemas import PixelRect
    
    # 60x60 mask with a stepped 2-line paragraph:
    # Line 1: y=10..20, x=10..50 (width 40)
    # Line 2: y=25..35, x=10..25 (width 15, leaves an empty notch at y=25..35, x=26..50)
    mask = np.zeros((60, 60), np.uint8)
    mask[10:20, 10:50] = 255
    mask[25:35, 10:25] = 255
    
    envelope = np.zeros((60, 60), np.uint8)
    envelope[8:38, 8:52] = 255
    protected_edges = np.zeros((60, 60), np.uint8)
    
    region = MaskRegion(
        id="test_para",
        rect=PixelRect(x=10, y=10, width=40, height=25),
        component_ids=(1, 2),
        stroke_radius=3,
    )
    
    smoothed = close_paragraph_notches(mask, [region], envelope, protected_edges)
    
    # The vertical inter-line gap (y=21..24, x=15..20) between lines should be bridged
    assert np.all(smoothed[21:24, 15:20] == 255), "Inter-line vertical gap should be closed"
    # Protected edges must still be respected
    assert np.all(smoothed[protected_edges > 0] == 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_mask_refiner.py -k test_paragraph_gap_closing_smoothes_notched_step -v`
Expected: FAIL with `ImportError: cannot import name 'close_paragraph_notches'`.

- [ ] **Step 3: Implement `close_paragraph_notches` in `mask_refiner.py`**

In `ocr-service/app/mask_refiner.py`:
```python
def close_paragraph_notches(
    mask: BinaryMask,
    regions: list[MaskRegion],
    envelope: BinaryMask | None,
    protected_edges: BinaryMask,
) -> BinaryMask:
    """Closes inter-line gaps and stepped notches in multi-line text blocks."""
    if envelope is None or not np.any(mask) or not regions:
        return mask

    result = mask.copy()
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 7))

    for region in regions:
        # Only multi-component or multi-line blocks benefit from paragraph gap closing
        if len(region.component_ids) < 2 and region.rect.height < 32:
            continue
        r = region.rect
        # Extract region crop
        y1, y2 = max(0, r.y), min(mask.shape[0], r.y + r.height)
        x1, x2 = max(0, r.x), min(mask.shape[1], r.x + r.width)
        sub_mask = result[y1:y2, x1:x2]
        if not np.any(sub_mask):
            continue

        closed = cv2.morphologyEx(sub_mask, cv2.MORPH_CLOSE, close_kernel)
        sub_env = envelope[y1:y2, x1:x2]
        sub_prot = protected_edges[y1:y2, x1:x2]
        
        # Bounded strictly by evidence envelope and protected edges
        valid_fill = (closed > 0) & (sub_env > 0) & (sub_prot == 0)
        result[y1:y2, x1:x2][valid_fill] = 255

    result[protected_edges > 0] = 0
    return result
```
And wire it into `refine_mask` before returning:
```python
    smoothed_mask = close_paragraph_notches(
        refined.mask,
        refined.regions,
        envelope,
        protected_edges,
    )
    refined = replace(refined, mask=smoothed_mask)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_mask_refiner.py -k test_paragraph_gap_closing_smoothes_notched_step -v`
Expected: PASS

- [ ] **Step 5: Run all mask refiner tests to ensure no regressions**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests/test_mask_refiner.py -v`
Expected: PASS

- [ ] **Step 6: Commit Task 3**

```bash
git add ocr-service/app/mask_refiner.py ocr-service/tests/test_mask_refiner.py
git commit -m "feat(mask): add paragraph gap and notch closing for multi-line text blocks"
```

---

### Task 4: Full Test Suite Regression Gate & Manga Image Verification

**Files:**
- Test: All Pytest suites (`ocr-service/tests`)
- Test: All Next.js/Vitest suites (`npm test`)
- Validation Script: `scratch/verify_cleaning_seam.py`

- [ ] **Step 1: Run full Pytest suite**

Run: `ocr-service\venv\Scripts\pytest ocr-service/tests -v`
Expected: All tests PASS (>= 192 passed, 3 skipped, 0 failures).

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Run full Vitest suite**

Run: `npm test`
Expected: 146/146 test files passed, 959+ tests passed, 0 failures.

- [ ] **Step 4: Verify real cleaning result on user sample crop**

Create scratch test script `scratch/verify_cleaning_seam.py` to run `pipeline.run()` on the sample page crop and assert that no residual boundary variance remains below line 4.
Run: `ocr-service\venv\Scripts\python.exe scratch/verify_cleaning_seam.py`
Expected: Clean inpainting output with 0 residual seams.

- [ ] **Step 5: Update `docs/AI-WORKING-NOTES.md` and commit**

Record the verified outcome (`VERIFIED WORKING`), test evidence, and commit changes.

```bash
git add docs/AI-WORKING-NOTES.md
git commit -m "docs: record verified working status for adaptive stroke dilation and compositor feathering"
```
