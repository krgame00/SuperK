# Aggressive Comic Text Cleaning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attempt to clean every detector-positive text region on confirmed comic pages while preserving hard-protected pixels and verifier rejection behavior.

**Architecture:** Keep page classification, protection, semantic eligibility, cleaning, and verification as separate existing stages. Remove the comic-margin review blocker, make low-confidence comic eligibility diagnostic rather than blocking, and add a benchmark coverage metric that distinguishes an unattempted region from a verifier-rejected repair.

**Tech Stack:** Python 3.12, NumPy, OpenCV, Pydantic, pytest, ONNX Runtime, existing SuperK benchmark scripts

## Global Constraints

- Run locally without paid APIs.
- Do not change detector models, thresholds, or mask refinement.
- Do not add a frontend toggle, API field, or persisted cleaning mode.
- Preserve all detected text on `UI`, `CREDITS`, and `UNKNOWN` pages.
- Preserve pixels intersecting QR and user-authored `Protect` masks.
- Allow logos, watermarks, and decorative lettering inside confirmed comic pages to be cleaned when detected.
- A cleaning attempt may still restore original pixels and return `NEEDS_REVIEW` when verification rejects the repair.
- Use only pages 1 through 10 from each approved folder for the targeted image run:
  - `E:\โด\[DawalixiP2]_Secret_Plan_[Fanbox]_[English]_[Omega_Scans]`
  - `E:\โด\nhentai-656214 - [JIMPU6] Finish SW999&Fugue (Honkai- Star Rail)`
- Keep verification focused: affected Python tests plus the 20-page targeted image run; do not rerun the full frontend/build suite because no frontend contract changes.
- Execute inline in the current task with review checkpoints; do not dispatch subagents.

---

## File Map

- Modify `ocr-service/app/protection.py`: stop placing compact outer-margin regions on confirmed comic pages into the blocking review mask.
- Modify `ocr-service/app/text_eligibility.py`: make comic review/low-confidence decisions cleanable while retaining role, confidence, and diagnostic reasons.
- Modify `ocr-service/scripts/benchmark.py`: measure and gate unattempted, unprotected comic detector regions.
- Modify `ocr-service/tests/test_protection.py`: specify that comic margin regions are no longer blocked.
- Modify `ocr-service/tests/test_text_eligibility.py`: specify aggressive actions for margin and low-confidence comic text plus unchanged non-comic and QR safety.
- Modify `ocr-service/tests/test_benchmark_manifest.py`: specify the new per-page and aggregate coverage metric.
- Create locally under ignored `ocr-service/benchmark-results/aggressive-20/`: targeted runner, JSON/Markdown reports, per-page visual artifacts, and contact sheets. These are evidence, not committed source.

---

### Task 1: Make Every Unprotected Comic Region Eligible

**Files:**
- Modify: `ocr-service/tests/test_protection.py`
- Modify: `ocr-service/tests/test_text_eligibility.py`
- Modify: `ocr-service/app/protection.py`
- Modify: `ocr-service/app/text_eligibility.py`

**Interfaces:**
- Consumes: `detect_protection(image_rgb, page, text_regions, *, qr_scanner=None) -> ProtectionResult`
- Consumes: `classify_eligibility(image_rgb, region_mask, region, page, protection, *, feature_extractor=None) -> EligibilityDecision`
- Produces: the same signatures and schemas; no caller or API migration
- Invariant: `AutomaticAction.CLEAN` means “attempt cleaning,” while pipeline verification remains authoritative

- [ ] **Step 1: Replace the comic-margin protection expectation with an aggressive expectation**

In `ocr-service/tests/test_protection.py`, replace `test_compact_margin_text_is_reviewed_on_comic_page` with:

```python
def test_compact_margin_text_is_not_blocked_on_comic_page() -> None:
    result = detect_protection(
        np.full((100, 100, 3), 255, np.uint8),
        _context(PageRole.COMIC),
        [_region(x=1, y=40, width=12, height=8)],
    )

    assert not np.any(result.review_mask)
    assert not np.any(result.protected_mask)
    assert result.regions == []
```

- [ ] **Step 2: Add failing eligibility tests for margin and low-confidence comic text**

In `ocr-service/tests/test_text_eligibility.py`, change the margin test and add low-confidence coverage:

```python
def test_margin_review_text_is_attempted_on_comic_page() -> None:
    decision = _classify(
        _features(enclosure=1),
        protection=_protection(review=True),
    )

    assert decision.action is AutomaticAction.CLEAN
    assert decision.text_role is TextRole.REVIEW
    assert ProtectionReason.MARGIN_MARK in decision.protection_reasons


def test_low_confidence_comic_text_is_attempted_for_review() -> None:
    decision = _classify(_features())

    assert decision.action is AutomaticAction.CLEAN
    assert decision.text_role is TextRole.REVIEW
    assert ProtectionReason.LOW_CONFIDENCE in decision.protection_reasons
```

Replace the two conservative threshold tests with:

```python
@pytest.mark.parametrize(
    ("score", "expected_role"),
    [
        (0.819, TextRole.REVIEW),
        (0.820, TextRole.NARRATION),
    ],
)
def test_narration_threshold_only_changes_semantic_role(
    score: float,
    expected_role: TextRole,
) -> None:
    decision = _classify(
        _features(uniformity=score, rectangular=score),
    )

    assert decision.action is AutomaticAction.CLEAN
    assert decision.text_role is expected_role
    assert (
        ProtectionReason.LOW_CONFIDENCE in decision.protection_reasons
    ) is (expected_role is TextRole.REVIEW)


@pytest.mark.parametrize(
    ("score", "expected_role"),
    [
        (0.899, TextRole.REVIEW),
        (0.900, TextRole.SFX),
    ],
)
def test_sfx_threshold_only_changes_semantic_role(
    score: float,
    expected_role: TextRole,
) -> None:
    decision = _classify(
        _features(artwork_edges=score, irregularity=score),
    )

    assert decision.action is AutomaticAction.CLEAN
    assert decision.text_role is expected_role
    assert (
        ProtectionReason.LOW_CONFIDENCE in decision.protection_reasons
    ) is (expected_role is TextRole.REVIEW)
```

- [ ] **Step 3: Add hard-protection coverage to the eligibility tests**

Add this focused test to `ocr-service/tests/test_text_eligibility.py`:

```python
def test_qr_intersection_remains_preserved_on_comic_page() -> None:
    decision = _classify(
        _features(enclosure=1),
        protection=_protection(protected=True),
    )

    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role is TextRole.PROTECTED
```

Keep `test_non_comic_page_is_never_automatically_cleaned` unchanged. Existing pipeline tests already cover protected-pixel identity and manual `Protect` restoration.

- [ ] **Step 4: Run the focused tests to verify the new behavior fails**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_protection.py tests/test_text_eligibility.py -q
```

Expected: failures show comic margin and low-confidence decisions are still preserved.

- [ ] **Step 5: Remove the comic outer-margin blocking mask**

In `ocr-service/app/protection.py`:

- Remove `OUTER_MARGIN_FRACTION` and `COMPACT_REGION_AREA_FRACTION`.
- Remove the final `page_area` / `for region in text_regions` block that fills `review`.
- Remove `_intersects_outer_margin`.
- Return `ProtectionResult(protected, review, regions)` directly for confirmed comic pages after the `UNKNOWN` branch.

Do not change QR, `CREDITS`, `UI`, or `UNKNOWN` branches.

- [ ] **Step 6: Convert comic review and low-confidence results into cleaning attempts**

In `ocr-service/app/text_eligibility.py`, keep the non-comic and `protected_mask` branches on `_preserve`, then replace the review-mask branch with:

```python
if _intersects(region_mask, protection.review_mask):
    reasons = _protection_reasons(
        protection,
        fallback=ProtectionReason.MARGIN_MARK,
    )
    return EligibilityDecision(
        text_role=TextRole.REVIEW,
        confidence=1.0,
        action=AutomaticAction.CLEAN,
        protection_reasons=reasons,
        features=features,
    )
```

Replace `_threshold_decision` with:

```python
def _threshold_decision(
    role: TextRole,
    confidence: float,
    threshold: float,
    features: EligibilityFeatures,
) -> EligibilityDecision:
    confident = confidence >= threshold
    return EligibilityDecision(
        text_role=role if confident else TextRole.REVIEW,
        confidence=confidence,
        action=AutomaticAction.CLEAN,
        protection_reasons=(
            [] if confident else [ProtectionReason.LOW_CONFIDENCE]
        ),
        features=features,
    )
```

Replace the final no-semantic-match `_preserve` call with:

```python
return EligibilityDecision(
    text_role=TextRole.REVIEW,
    confidence=float(np.clip(max(narration_score, sfx_score), 0, 1)),
    action=AutomaticAction.CLEAN,
    protection_reasons=[ProtectionReason.LOW_CONFIDENCE],
    features=features,
)
```

- [ ] **Step 7: Run affected safety and behavior tests**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_protection.py tests/test_text_eligibility.py tests/test_pipeline.py -q
.\.venv\Scripts\python.exe -m ruff check app/protection.py app/text_eligibility.py tests/test_protection.py tests/test_text_eligibility.py
```

Expected: all selected tests pass and Ruff reports no errors.

- [ ] **Step 8: Commit Task 1**

```powershell
git add ocr-service/app/protection.py ocr-service/app/text_eligibility.py ocr-service/tests/test_protection.py ocr-service/tests/test_text_eligibility.py
git commit -m "feat(cleaning): attempt all comic text"
```

**Checkpoint:** Review the diff and selected test output before adding benchmark reporting.

---

### Task 2: Gate Unattempted Comic Detector Regions

**Files:**
- Modify: `ocr-service/tests/test_benchmark_manifest.py`
- Modify: `ocr-service/scripts/benchmark.py`

**Interfaces:**
- Produces: `count_unattempted_comic_regions(output: PipelineOutput) -> int`
- Produces per page: `comic_unattempted_detected_region_count: int`
- Produces aggregate summary: `comic_unattempted_detected_region_count: int`
- Acceptance: aggregate value must equal `0`

- [ ] **Step 1: Add a failing helper test**

Import the benchmark helper and add these exact fixtures and test in `ocr-service/tests/test_benchmark_manifest.py`:

```python
import numpy as np

from app.pipeline import PipelineOutput
from app.schemas import (
    AutomaticAction,
    CleanerRoute,
    PageRole,
    PixelRect,
    RegionRecord,
    RegionStatus,
    TextRole,
)
from scripts.benchmark import count_unattempted_comic_regions


def _benchmark_region(
    region_id: str,
    action: AutomaticAction,
    *,
    x: int = 0,
) -> RegionRecord:
    return RegionRecord(
        id=region_id,
        rect=PixelRect(x=x, y=8, width=8, height=8),
        route=CleanerRoute.FLAT,
        confidence=0.8,
        status=RegionStatus.PRESERVED,
        residual_score=0,
        damage_score=0,
        page_role=PageRole.COMIC,
        text_role=TextRole.REVIEW,
        eligibility_confidence=0.5,
        automatic_action=action,
        protection_reasons=[],
    )


def _benchmark_output(
    regions: list[RegionRecord],
    *,
    protected_slice: tuple[int, int],
) -> PipelineOutput:
    source = np.zeros((32, 32, 3), np.uint8)
    mask = np.zeros((32, 32), np.uint8)
    protected = np.zeros_like(mask)
    protected[8:16, protected_slice[0] : protected_slice[1]] = 255
    return PipelineOutput(
        source_image=source,
        clean_image=source.copy(),
        mask=mask.copy(),
        review_mask=mask.copy(),
        protected_mask=protected,
        regions=regions,
        timings_ms={"total": 1},
    )


def test_unattempted_metric_excludes_hard_protected_regions() -> None:
    output = _benchmark_output(
        [
            _benchmark_region("attempted", AutomaticAction.CLEAN),
            _benchmark_region("missed", AutomaticAction.PRESERVE, x=8),
            _benchmark_region("protected", AutomaticAction.PRESERVE, x=16),
        ],
        protected_slice=(16, 24),
    )

    assert count_unattempted_comic_regions(output) == 1
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_benchmark_manifest.py::test_unattempted_metric_excludes_hard_protected_regions -q
```

Expected: import failure because `count_unattempted_comic_regions` does not exist.

- [ ] **Step 3: Implement the coverage helper**

In `ocr-service/scripts/benchmark.py`, change the relevant imports to:

```python
from app.pipeline import CleaningPipeline, PipelineOutput
from app.schemas import (
    AutomaticAction,
    CleanerRoute,
    PageRole,
    RegionStatus,
)
```

Then add:

```python
def count_unattempted_comic_regions(output: PipelineOutput) -> int:
    count = 0
    for region in output.regions:
        if (
            region.page_role is not PageRole.COMIC
            or region.automatic_action is AutomaticAction.CLEAN
        ):
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

This counts eligibility misses but excludes QR/manual hard protection. Verifier-rejected repairs retain `AutomaticAction.CLEAN`, so they are not misreported as unattempted.

- [ ] **Step 4: Add the metric to page, summary, report, and pass gate**

In `measure_page`, add:

```python
"comic_unattempted_detected_region_count": (
    count_unattempted_comic_regions(output)
),
```

In `aggregate`, sum that field into the same summary key. Add `summary["comic_unattempted_detected_region_count"] == 0` to `summary["passed"]`.

In `markdown_report`, add:

```python
(
    f"- Unattempted comic detector regions: "
    f"{summary['comic_unattempted_detected_region_count']}"
),
```

- [ ] **Step 5: Test the helper and affected benchmark code**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_benchmark_manifest.py -q
.\.venv\Scripts\python.exe -m ruff check scripts/benchmark.py tests/test_benchmark_manifest.py
```

Expected: selected tests pass and Ruff reports no errors.

- [ ] **Step 6: Commit Task 2**

```powershell
git add ocr-service/scripts/benchmark.py ocr-service/tests/test_benchmark_manifest.py
git commit -m "test(cleaning): gate comic attempt coverage"
```

**Checkpoint:** Confirm the new metric is based on automatic action plus hard-mask intersection, not final repair status.

---

### Task 3: Run the Approved 20-Page Targeted Trial

**Files:**
- Create locally, ignored: `ocr-service/benchmark-results/aggressive-20/run_targeted.py`
- Create locally, ignored: `ocr-service/benchmark-results/aggressive-20/report.json`
- Create locally, ignored: `ocr-service/benchmark-results/aggressive-20/report.md`
- Create locally, ignored: `ocr-service/benchmark-results/aggressive-20/visual/*.jpg`
- Create locally, ignored: `ocr-service/benchmark-results/aggressive-20/contact-sheet-*.jpg`
- No committed source changes

**Interfaces:**
- Consumes: `build_pipeline`, `load_rgb`, and `measure_page` from `scripts/benchmark.py`
- Selects: `1.webp` through `10.webp` from each approved folder, exactly 20 pages
- Produces: machine-readable metrics plus four five-page contact sheets

- [ ] **Step 1: Verify the exact 20 inputs before processing**

Run:

```powershell
$folders = @(
  'E:\โด\[DawalixiP2]_Secret_Plan_[Fanbox]_[English]_[Omega_Scans]',
  'E:\โด\nhentai-656214 - [JIMPU6] Finish SW999&Fugue (Honkai- Star Rail)'
)
$pages = foreach ($folder in $folders) {
  1..10 | ForEach-Object { Join-Path $folder "$_.webp" }
}
$missing = $pages | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) { throw "Missing pages: $($missing -join ', ')" }
$pages
```

Expected: exactly 20 existing paths, numbered 1–10 in each folder.

- [ ] **Step 2: Create the ignored targeted runner**

Use `apply_patch` to create `ocr-service/benchmark-results/aggressive-20/run_targeted.py`. The runner must:

```python
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SERVICE_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SERVICE_ROOT))

from scripts.benchmark import build_pipeline, load_rgb, measure_page
from scripts.build_benchmark_manifest import (
    anonymized_relative_path_hash,
    sha256_file,
)

OUTPUT = Path(__file__).resolve().parent
VISUAL = OUTPUT / "visual"
CORPUS_ROOT = Path("E:/โด")
FOLDERS = (
    CORPUS_ROOT
    / "[DawalixiP2]_Secret_Plan_[Fanbox]_[English]_[Omega_Scans]",
    CORPUS_ROOT
    / "nhentai-656214 - [JIMPU6] Finish SW999&Fugue (Honkai- Star Rail)",
)
PAGES = [
    folder / f"{number}.webp"
    for folder in FOLDERS
    for number in range(1, 11)
]


def ratio(numerator: int, denominator: int) -> float:
    return 1.0 if denominator == 0 else numerator / denominator


def percentile(values: list[int], quantile: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def write_contact_sheets(hashes: list[str]) -> None:
    label = "Original | Clean | Eligible (red) | Protected (blue) | Diff x5"
    for sheet_index in range(4):
        selected = hashes[sheet_index * 5 : sheet_index * 5 + 5]
        rows: list[Image.Image] = []
        for digest in selected:
            artifact = Image.open(VISUAL / f"{digest[:12]}.jpg").convert("RGB")
            row = Image.new("RGB", (artifact.width, artifact.height + 24), "white")
            ImageDraw.Draw(row).text((8, 5), label, fill="black")
            row.paste(artifact, (0, 24))
            rows.append(row)
        width = max(row.width for row in rows)
        height = sum(row.height for row in rows)
        sheet = Image.new("RGB", (width, height), "white")
        y = 0
        for row in rows:
            sheet.paste(row, (0, y))
            y += row.height
        sheet.save(OUTPUT / f"contact-sheet-{sheet_index + 1}.jpg", quality=92)


def main() -> None:
    missing = [str(path) for path in PAGES if not path.is_file()]
    if missing:
        raise RuntimeError(f"missing targeted pages: {missing}")

    pipeline = build_pipeline(SERVICE_ROOT, "aot")
    pipeline.run(load_rgb(PAGES[0]))
    page_reports = []
    hashes = []
    for index, path in enumerate(PAGES, start=1):
        digest = sha256_file(path)
        hashes.append(digest)
        print(f"Targeted benchmark {index}/20", flush=True)
        page_reports.append(
            measure_page(
                pipeline,
                path,
                {
                    "relative_path_hash": anonymized_relative_path_hash(
                        path,
                        CORPUS_ROOT,
                    ),
                    "sha256": digest,
                    "categories": ["targeted"],
                },
                {digest},
                VISUAL,
            ),
        )

    eligible = sum(page["eligible_region_count"] for page in page_reports)
    total_regions = sum(page["region_count"] for page in page_reports)
    residual_passes = sum(
        round(page["residual_pass_rate"] * page["eligible_region_count"])
        for page in page_reports
    )
    automatic_passes = sum(
        round(
            page["automatic_region_pass_rate"]
            * page["eligible_region_count"],
        )
        for page in page_reports
    )
    totals = [page["timings_ms"]["total"] for page in page_reports]
    summary = {
        "median_total_ms": round(statistics.median(totals)),
        "p95_total_ms": round(percentile(totals, 0.95)),
        "residual_pass_rate": ratio(residual_passes, eligible),
        "automatic_region_pass_rate": ratio(automatic_passes, eligible),
        "needs_review_rate": ratio(
            total_regions - automatic_passes,
            total_regions,
        ),
        "comic_unattempted_detected_region_count": sum(
            page["comic_unattempted_detected_region_count"]
            for page in page_reports
        ),
        "changed_pixels_outside_support": sum(
            page["changed_pixels_outside_support"]
            for page in page_reports
        ),
        "changed_pixels_inside_protected": sum(
            page["changed_pixels_inside_protected"]
            for page in page_reports
        ),
        "peak_rss_mb": max(page["peak_rss_mb"] for page in page_reports),
    }
    summary["passed"] = bool(
        summary["median_total_ms"] <= 30_000
        and summary["residual_pass_rate"] >= 0.95
        and summary["automatic_region_pass_rate"] >= 0.90
        and summary["comic_unattempted_detected_region_count"] == 0
        and summary["changed_pixels_outside_support"] == 0
        and summary["changed_pixels_inside_protected"] == 0
    )
    report = {
        "version": 1,
        "page_count": len(page_reports),
        "pages": page_reports,
        "summary": summary,
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "report.json").write_text(
        json.dumps(report, indent=2) + "\n",
        encoding="utf-8",
    )
    lines = [
        "# Aggressive comic targeted benchmark",
        "",
        f"- Pages: {len(page_reports)}",
        f"- Median: {summary['median_total_ms']} ms",
        f"- p95: {summary['p95_total_ms']} ms",
        f"- Residual pass: {summary['residual_pass_rate']:.1%}",
        (
            f"- Automatic repair pass: "
            f"{summary['automatic_region_pass_rate']:.1%}"
        ),
        f"- Needs review: {summary['needs_review_rate']:.1%}",
        (
            f"- Unattempted comic regions: "
            f"{summary['comic_unattempted_detected_region_count']}"
        ),
        (
            f"- Changed outside support: "
            f"{summary['changed_pixels_outside_support']}"
        ),
        (
            f"- Changed inside protection: "
            f"{summary['changed_pixels_inside_protected']}"
        ),
        f"- Peak RSS: {summary['peak_rss_mb']:.1f} MB",
        f"- Acceptance: {'PASS' if summary['passed'] else 'FAIL'}",
    ]
    (OUTPUT / "report.md").write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
    )
    write_contact_sheets(hashes)


if __name__ == "__main__":
    main()
```

The runner must not copy source images or include the external source paths in either report.

- [ ] **Step 3: Run the targeted trial**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe benchmark-results/aggressive-20/run_targeted.py
```

Expected: 1 warm-up plus 20 measured pages; output remains inside the ignored `benchmark-results/aggressive-20` directory.

- [ ] **Step 4: Inspect metrics and visual sheets**

Run:

```powershell
Get-Content benchmark-results/aggressive-20/report.md
Get-ChildItem benchmark-results/aggressive-20/contact-sheet-*.jpg
```

Inspect all four contact sheets for:

- source text left behind,
- logos/watermarks removed as an accepted risk,
- bubble or panel border damage,
- character/artwork damage,
- seams or rectangular patches,
- red eligible masks missing detected comic regions,
- blue protected areas changing.

Open the sheets in the Windows image viewer when necessary because Codex image links were not clickable for the user in the prior review.

- [ ] **Step 5: Run the final lean regression set**

Run:

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_protection.py tests/test_text_eligibility.py tests/test_pipeline.py tests/test_benchmark_manifest.py -q
.\.venv\Scripts\python.exe -m ruff check app/protection.py app/text_eligibility.py scripts/benchmark.py tests/test_protection.py tests/test_text_eligibility.py tests/test_benchmark_manifest.py
git diff --check
git status --short
```

Expected: selected tests and Ruff pass; `git diff --check` is clean; benchmark artifacts remain ignored.

- [ ] **Step 6: Report the checkpoint**

Report:

- the exact count of selected tests passed,
- 20-page median and p95,
- residual and automatic repair pass rates,
- `comic_unattempted_detected_region_count`,
- changed pixels outside support and inside protection,
- remaining `NEEDS_REVIEW` count caused by verifier rejection,
- visual findings and the four local sheet paths,
- both implementation commit hashes.

Do not claim the behavior complete if any unprotected comic region was not attempted or protected pixels changed.
