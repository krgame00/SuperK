# Aggressive All-Role Text Cleaning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the committed aggressive comic policy so every unprotected detector region is attempted on `COMIC`, `UI`, `CREDITS`, and `UNKNOWN` pages.

**Architecture:** Keep page classification as diagnostic metadata, but remove page role from protection and eligibility decisions. QR/manual masks remain the only hard protection, verifier rejection remains unchanged, and benchmark coverage is generalized from comic-only to every page role.

**Tech Stack:** Python 3.12, NumPy, OpenCV, Pydantic, pytest, Ruff, existing SuperK benchmark pipeline

## Global Constraints

- Do not change detector models, thresholds, mask refinement, cleaner routing, verifier thresholds, frontend, or API schemas.
- Do not add a UI toggle, API field, or persisted mode.
- QR and manual `Protect` pixels must remain unchanged.
- UI text, credits, logos, watermarks, and decorative lettering may be removed.
- Use inline execution only; do not dispatch subagents.
- Run focused Python tests plus pages 1–10 from each approved folder; do not rerun frontend/build suites.
- Approved folders:
  - `E:\โด\[DawalixiP2]_Secret_Plan_[Fanbox]_[English]_[Omega_Scans]`
  - `E:\โด\nhentai-656214 - [JIMPU6] Finish SW999&Fugue (Honkai- Star Rail)`

---

### Task 1: Remove Page-Role Protection and Eligibility Blocks

**Files:**
- Modify: `ocr-service/tests/test_protection.py`
- Modify: `ocr-service/tests/test_text_eligibility.py`
- Modify: `ocr-service/app/protection.py`
- Modify: `ocr-service/app/text_eligibility.py`

**Interfaces:**
- Preserve: `detect_protection(image_rgb, page, text_regions, *, qr_scanner=None) -> ProtectionResult`
- Preserve: `classify_eligibility(image_rgb, region_mask, region, page, protection, *, feature_extractor=None) -> EligibilityDecision`
- Change: page role remains in `PageContext` and `RegionRecord`, but cannot produce `PRESERVE`
- Preserve: intersection with `protected_mask` produces `PRESERVE`

- [ ] **Step 1: Replace page-role protection tests**

In `ocr-service/tests/test_protection.py`, replace the credit and unknown page tests with:

```python
@pytest.mark.parametrize(
    "role",
    [PageRole.CREDITS, PageRole.UI, PageRole.UNKNOWN],
)
def test_page_role_does_not_create_protection(role: PageRole) -> None:
    result = detect_protection(
        np.full((100, 100, 3), 255, np.uint8),
        _context(role),
        [_region()],
    )

    assert not np.any(result.protected_mask)
    assert not np.any(result.review_mask)
    assert result.regions == []
```

Add `import pytest`. Keep `test_qr_polygon_is_protected_with_eight_pixel_margin` unchanged.

- [ ] **Step 2: Replace the non-comic eligibility test**

In `ocr-service/tests/test_text_eligibility.py`, replace `test_non_comic_page_is_never_automatically_cleaned` with:

```python
@pytest.mark.parametrize(
    "role",
    [PageRole.UI, PageRole.CREDITS, PageRole.UNKNOWN],
)
def test_unprotected_text_is_attempted_on_every_page_role(
    role: PageRole,
) -> None:
    decision = _classify(
        _features(enclosure=1),
        page=_page(role),
    )

    assert decision.text_role is TextRole.DIALOGUE
    assert decision.action is AutomaticAction.CLEAN
    assert decision.protection_reasons == []
```

Keep the QR intersection test unchanged so RED proves page-role behavior changes without weakening hard protection.

- [ ] **Step 3: Run RED tests**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_protection.py tests/test_text_eligibility.py -q
```

Expected: failures only for `UI`, `CREDITS`, and `UNKNOWN` page-role cases; QR protection still passes.

- [ ] **Step 4: Remove page-role masks from protection**

In `ocr-service/app/protection.py`:

- Remove `PageRole` from the schema import.
- Delete the `CREDITS`/`UI` branch that fills `protected`.
- Delete the `UNKNOWN` branch that fills `review`.
- Delete `_fill_rect`, which becomes unused.
- Keep QR scanning/dilation and return the QR-only masks after scanning.
- Keep the `page` and `text_regions` parameters for interface compatibility.

The function tail after QR scanning becomes:

```python
return ProtectionResult(protected, review, regions)
```

- [ ] **Step 5: Remove page-role preservation from eligibility**

In `ocr-service/app/text_eligibility.py`:

- Remove `PageRole` from imports.
- Delete the initial `if page.role is not PageRole.COMIC` `_preserve` branch.
- Delete `_page_reason`, which becomes unused.
- Keep the `page` parameter for interface compatibility.
- Leave the `protected_mask` intersection branch before all semantic decisions.
- Leave the aggressive review/low-confidence behavior from commit `644aed6` unchanged.

- [ ] **Step 6: Run GREEN tests and focused pipeline safety**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_protection.py tests/test_text_eligibility.py tests/test_pipeline.py -q
.\.venv\Scripts\python.exe -m ruff check app/protection.py app/text_eligibility.py tests/test_protection.py tests/test_text_eligibility.py
```

Expected: all selected tests pass; QR and manual `Protect` safety tests remain green; Ruff passes.

**Checkpoint:** Inspect the diff before changing benchmark names.

---

### Task 2: Generalize Attempt Coverage to Every Page Role

**Files:**
- Modify: `ocr-service/tests/test_benchmark_manifest.py`
- Modify: `ocr-service/scripts/benchmark.py`
- Modify locally, ignored: `ocr-service/benchmark-results/aggressive-20/run_targeted.py`

**Interfaces:**
- Rename: `count_unattempted_comic_regions` → `count_unattempted_detected_regions`
- Rename report key: `comic_unattempted_detected_region_count` → `unattempted_detected_region_count`
- Count: any `PRESERVE` detector region without protected-mask intersection, regardless of `page_role`

- [ ] **Step 1: Generalize the benchmark test first**

In `ocr-service/tests/test_benchmark_manifest.py`:

1. Import `count_unattempted_detected_regions`.
2. Add `role: PageRole = PageRole.COMIC` to `_benchmark_region`.
3. Set `page_role=role`.
4. Replace the metric test with:

```python
def test_unattempted_metric_covers_every_page_role() -> None:
    output = _benchmark_output(
        [
            _benchmark_region("attempted", AutomaticAction.CLEAN),
            _benchmark_region(
                "missed-ui",
                AutomaticAction.PRESERVE,
                x=8,
                role=PageRole.UI,
            ),
            _benchmark_region(
                "protected-credit",
                AutomaticAction.PRESERVE,
                x=16,
                role=PageRole.CREDITS,
            ),
        ],
        protected_slice=(16, 24),
    )

    assert count_unattempted_detected_regions(output) == 1
```

- [ ] **Step 2: Run RED metric test**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_benchmark_manifest.py::test_unattempted_metric_covers_every_page_role -q
```

Expected: import failure because the generalized helper does not exist.

- [ ] **Step 3: Generalize the helper and report keys**

In `ocr-service/scripts/benchmark.py`, replace the helper with:

```python
def count_unattempted_detected_regions(output: PipelineOutput) -> int:
    count = 0
    for region in output.regions:
        if region.automatic_action is AutomaticAction.CLEAN:
            continue
        rect = region.rect
        protected = output.protected_mask[
            rect.y : rect.y + rect.height,
            rect.x : rect.x + rect.width,
        ]
        if not np.any(protected):
            count += 1
    return count
```

Remove the now-unused `PageRole` import. Rename the per-page and aggregate keys to `unattempted_detected_region_count`, call the new helper, update the zero-value pass gate, and change the Markdown line to:

```python
(
    f"- Unattempted detector regions: "
    f"{summary['unattempted_detected_region_count']}"
),
```

- [ ] **Step 4: Retire UI/Credits pixel-identity acceptance**

In `aggregate`:

- Remove `credit_ui_pages_pixel_identical` from the summary.
- Remove that field from `summary["passed"]`.

In `markdown_report`, remove the `Credit/UI identity` line. Do not remove changed-inside-protection checks.

- [ ] **Step 5: Update and verify benchmark tests**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_benchmark_manifest.py -q
.\.venv\Scripts\python.exe -m ruff check scripts/benchmark.py tests/test_benchmark_manifest.py
```

Expected: all benchmark tests and Ruff pass.

- [ ] **Step 6: Update the ignored targeted runner**

In `ocr-service/benchmark-results/aggressive-20/run_targeted.py`, rename both occurrences of `comic_unattempted_detected_region_count` to `unattempted_detected_region_count` and change the Markdown label to `Unattempted detector regions`.

- [ ] **Step 7: Commit Tasks 1–2 together**

Run:

```powershell
git add ocr-service/app/protection.py ocr-service/app/text_eligibility.py ocr-service/scripts/benchmark.py ocr-service/tests/test_protection.py ocr-service/tests/test_text_eligibility.py ocr-service/tests/test_benchmark_manifest.py
git commit -m "feat(cleaning): clean every detected region"
```

The ignored runner and reports must not be staged.

---

### Task 3: Repeat the Approved 20-Page Trial

**Files:**
- Regenerate locally, ignored: `ocr-service/benchmark-results/aggressive-20/report.json`
- Regenerate locally, ignored: `ocr-service/benchmark-results/aggressive-20/report.md`
- Regenerate locally, ignored: `ocr-service/benchmark-results/aggressive-20/visual/*.jpg`
- Regenerate locally, ignored: `ocr-service/benchmark-results/aggressive-20/contact-sheet-*.jpg`

**Interfaces:**
- Inputs: exactly pages 1–10 from both approved folders
- Required metric: `unattempted_detected_region_count = 0`
- Required safety: changed pixels outside support = 0; changed pixels inside protection = 0

- [ ] **Step 1: Rerun the existing targeted runner**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe benchmark-results/aggressive-20/run_targeted.py
Get-Content benchmark-results/aggressive-20/report.md
```

Expected: 1 warm-up plus 20 pages; report contains the generalized zero-attempt metric.

- [ ] **Step 2: Inspect all four regenerated contact sheets**

Verify:

- pages 4, 5, 7, and 8 of the first folder now have red eligible masks and cleaned output,
- detector-positive source text is not preserved because of page role,
- QR/protected pixels do not change,
- no broad rectangles, seams, or obvious artwork destruction appear,
- stylized text absent from the detector mask is reported separately as detector recall, not eligibility failure.

Open the first sheet in Windows because local links were not clickable for the user.

- [ ] **Step 3: Run final lean verification**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_protection.py tests/test_text_eligibility.py tests/test_pipeline.py tests/test_benchmark_manifest.py -q
.\.venv\Scripts\python.exe -m ruff check app/protection.py app/text_eligibility.py scripts/benchmark.py tests/test_protection.py tests/test_text_eligibility.py tests/test_benchmark_manifest.py
git diff --check
git status --short
```

Expected: focused tests and Ruff pass; committed worktree is clean; benchmark artifacts remain ignored.

- [ ] **Step 4: Report evidence**

Report exact tests passed, commit hash, median, p95, automatic repair pass, verifier `NEEDS_REVIEW`, unattempted detector regions, changed pixels outside support/protection, and visual findings.

