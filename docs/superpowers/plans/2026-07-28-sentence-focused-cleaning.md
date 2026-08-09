# Sentence-Focused Text Cleaning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean dialogue, narration, and review regions across every page role while intentionally preserving high-confidence SFX.

**Architecture:** Keep the single-pass CTD detector and all-role eligibility flow. Add an explicit SFX policy decision in semantic eligibility, retain QR/manual hard protection, and split benchmark reporting into policy violations versus intentionally preserved SFX.

**Tech Stack:** Python 3.12, NumPy, OpenCV, Pydantic, pytest, Ruff, existing CTD/AOT pipeline

## Global Constraints

- Do not add tiled, multi-scale, contrast, OCR, or secondary detection.
- Do not change detector, refiner, cleaner, verifier, frontend, or endpoint behavior.
- Keep page role diagnostic-only.
- Preserve QR and manual `Protect`.
- Run inline without subagents.
- Test only affected Python files and the approved ten pages.
- Approved inputs:
  - `F:\Doujin\Download\CieloBivolta\01.webp` through `05.webp`; exclude `(1)` files.
  - `E:\โด\nhentai-656214 - [JIMPU6] Finish SW999&Fugue (Honkai- Star Rail)\1.webp` through `5.webp`.

---

### Task 1: Preserve High-Confidence SFX

**Files:**
- Modify: `ocr-service/app/schemas.py`
- Modify: `ocr-service/app/text_eligibility.py`
- Modify: `ocr-service/tests/test_text_eligibility.py`
- Modify: `ocr-service/tests/test_pipeline.py`

**Interfaces:**
- Add: `ProtectionReason.SFX_POLICY = "sfx-policy"`
- Preserve: `classify_eligibility(...) -> EligibilityDecision`
- Policy: SFX confidence ≥ `SFX_THRESHOLD` returns `SFX/PRESERVE/SFX_POLICY`
- Policy: SFX confidence below threshold returns `REVIEW/CLEAN/LOW_CONFIDENCE`

- [ ] **Step 1: Change SFX eligibility expectations first**

In `tests/test_text_eligibility.py`, change both existing confident SFX tests to assert:

```python
assert decision.text_role is TextRole.SFX
assert decision.confidence >= 0.90
assert decision.action is AutomaticAction.PRESERVE
assert decision.protection_reasons == [ProtectionReason.SFX_POLICY]
```

Replace the SFX threshold test with:

```python
@pytest.mark.parametrize(
    ("score", "expected_role", "expected_action", "expected_reason"),
    [
        (
            0.899,
            TextRole.REVIEW,
            AutomaticAction.CLEAN,
            ProtectionReason.LOW_CONFIDENCE,
        ),
        (
            0.900,
            TextRole.SFX,
            AutomaticAction.PRESERVE,
            ProtectionReason.SFX_POLICY,
        ),
    ],
)
def test_sfx_threshold_controls_preservation(
    score: float,
    expected_role: TextRole,
    expected_action: AutomaticAction,
    expected_reason: ProtectionReason,
) -> None:
    decision = _classify(
        _features(artwork_edges=score, irregularity=score),
    )

    assert decision.text_role is expected_role
    assert decision.action is expected_action
    assert decision.protection_reasons == [expected_reason]
```

- [ ] **Step 2: Add a pipeline test that proves preserved SFX is not cleaned**

In `tests/test_pipeline.py`, add:

```python
def test_policy_preserved_sfx_is_not_sent_to_cleaner() -> None:
    mask = np.zeros((32, 32), np.uint8)
    mask[8:16, 8:16] = 255
    region = MaskRegion(
        id="sfx-1",
        rect=PixelRect(x=8, y=8, width=8, height=8),
        component_ids=(1,),
        stroke_radius=2,
    )

    def sfx_decision(*_args) -> EligibilityDecision:
        return EligibilityDecision(
            text_role=TextRole.SFX,
            confidence=0.95,
            action=AutomaticAction.PRESERVE,
            protection_reasons=[ProtectionReason.SFX_POLICY],
            features=EligibilityFeatures(
                enclosure_score=0,
                backing_uniformity=0,
                rectangular_backing=0,
                artwork_edge_density=0.95,
                stroke_irregularity=0.95,
                margin_fraction=0,
            ),
        )

    class FailingCleaner:
        def clean(self, *_args):
            raise AssertionError("policy-preserved SFX reached cleaner")

    failing_cleaner = FailingCleaner()
    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        refiner=lambda _source, _detection: RefinedMask(
            mask,
            [region],
            np.zeros_like(mask),
        ),
        cleaners={
            "flat": failing_cleaner,
            "gradient": failing_cleaner,
            "artwork": failing_cleaner,
        },
        page_classifier=_comic_page,
        protection_detector=_empty_protection,
        eligibility_classifier=sfx_decision,
    )
    source = np.full((32, 32, 3), 100, np.uint8)
    output = pipeline.run(source)

    assert np.array_equal(output.clean_image, source)
    assert output.regions[0].status is RegionStatus.PRESERVED
    assert output.regions[0].text_role is TextRole.SFX
    assert output.regions[0].automatic_action is AutomaticAction.PRESERVE
```

Import `ProtectionReason` in that test module.

- [ ] **Step 3: Run RED tests**

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_text_eligibility.py tests/test_pipeline.py -q
```

Expected: `SFX_POLICY` is missing and existing confident SFX is still `CLEAN`.

- [ ] **Step 4: Add the enum and SFX decision**

In `app/schemas.py`, add:

```python
SFX_POLICY = "sfx-policy"
```

to `ProtectionReason`.

In `app/text_eligibility.py`, replace the SFX `_threshold_decision` call with `_sfx_decision(sfx_score, features)` and add:

```python
def _sfx_decision(
    confidence: float,
    features: EligibilityFeatures,
) -> EligibilityDecision:
    if confidence >= SFX_THRESHOLD:
        return EligibilityDecision(
            text_role=TextRole.SFX,
            confidence=confidence,
            action=AutomaticAction.PRESERVE,
            protection_reasons=[ProtectionReason.SFX_POLICY],
            features=features,
        )
    return EligibilityDecision(
        text_role=TextRole.REVIEW,
        confidence=confidence,
        action=AutomaticAction.CLEAN,
        protection_reasons=[ProtectionReason.LOW_CONFIDENCE],
        features=features,
    )
```

Do not change narration `_threshold_decision`.

- [ ] **Step 5: Run GREEN tests and Ruff**

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_text_eligibility.py tests/test_pipeline.py tests/test_protection.py -q
.\.venv\Scripts\python.exe -m ruff check app/schemas.py app/text_eligibility.py tests/test_text_eligibility.py tests/test_pipeline.py
```

Expected: selected tests and Ruff pass.

---

### Task 2: Report Policy Preservation Correctly

**Files:**
- Modify: `ocr-service/scripts/benchmark.py`
- Modify: `ocr-service/tests/test_benchmark_manifest.py`

**Interfaces:**
- Rename: `count_unattempted_detected_regions` → `count_unexpected_unattempted_regions`
- Add: `count_preserved_sfx_regions`
- Rename report key: `unattempted_detected_region_count` → `unexpected_unattempted_region_count`
- Add report key: `preserved_sfx_region_count`

- [ ] **Step 1: Write benchmark tests first**

Update the benchmark helper import and replace the policy metric test with:

```python
def test_policy_metrics_exclude_preserved_sfx_and_hard_protection() -> None:
    output = _benchmark_output(
        [
            _benchmark_region("attempted", AutomaticAction.CLEAN),
            _benchmark_region(
                "unexpected",
                AutomaticAction.PRESERVE,
                x=8,
                role=PageRole.UI,
            ),
            _benchmark_region(
                "sfx",
                AutomaticAction.PRESERVE,
                x=16,
                text_role=TextRole.SFX,
            ),
            _benchmark_region(
                "protected",
                AutomaticAction.PRESERVE,
                x=24,
            ),
        ],
        protected_slice=(24, 32),
    )

    assert count_unexpected_unattempted_regions(output) == 1
    assert count_preserved_sfx_regions(output) == 1
```

Add `text_role: TextRole = TextRole.REVIEW` and
`protection_reasons: list[ProtectionReason] | None = None` to
`_benchmark_region`, then assign both to the record. The SFX fixture must use:

```python
text_role=TextRole.SFX,
protection_reasons=[ProtectionReason.SFX_POLICY],
```

- [ ] **Step 2: Run RED metric test**

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_benchmark_manifest.py::test_policy_metrics_exclude_preserved_sfx_and_hard_protection -q
```

Expected: new helper imports do not exist.

- [ ] **Step 3: Implement policy metrics**

In `scripts/benchmark.py`, rename the existing helper and exclude SFX:

```python
def count_unexpected_unattempted_regions(output: PipelineOutput) -> int:
    count = 0
    for region in output.regions:
        if (
            region.automatic_action is AutomaticAction.CLEAN
            or ProtectionReason.SFX_POLICY in region.protection_reasons
        ):
            continue
        if not _record_intersects_mask(region, output.protected_mask):
            count += 1
    return count


def count_preserved_sfx_regions(output: PipelineOutput) -> int:
    return sum(
        region.text_role is TextRole.SFX
        and region.automatic_action is AutomaticAction.PRESERVE
        and ProtectionReason.SFX_POLICY in region.protection_reasons
        and not _record_intersects_mask(region, output.protected_mask)
        for region in output.regions
    )
```

Extract the existing rectangle/mask intersection into:

```python
def _record_intersects_mask(region: RegionRecord, mask: np.ndarray) -> bool:
    rect = region.rect
    return bool(
        np.any(
            mask[
                rect.y : rect.y + rect.height,
                rect.x : rect.x + rect.width,
            ],
        ),
    )
```

Import `ProtectionReason`, `RegionRecord`, and `TextRole`.

- [ ] **Step 4: Update page, aggregate, gate, and Markdown keys**

Add both metrics to `measure_page`, sum both in `aggregate`, gate only `unexpected_unattempted_region_count == 0`, and report:

```python
f"- Unexpected unattempted regions: {summary['unexpected_unattempted_region_count']}"
f"- Preserved SFX regions: {summary['preserved_sfx_region_count']}"
```

Keep intentional SFX preservation separate from verifier failure:

- Per-page `needs_review_count` is the number of records whose status is
  `RegionStatus.NEEDS_REVIEW`.
- Per-page `needs_review_rate` is `needs_review_count / region_count`.
- Aggregate `needs_review_count` is the sum of page counts.
- Aggregate `needs_review_rate` is aggregate count divided by total regions.
- Do not infer Needs Review from `automatic_action is not CLEAN`; that would
  incorrectly count intentionally preserved SFX as failures.

- [ ] **Step 5: Verify benchmark tests and Ruff**

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_benchmark_manifest.py -q
.\.venv\Scripts\python.exe -m ruff check scripts/benchmark.py tests/test_benchmark_manifest.py
```

Expected: tests and Ruff pass.

- [ ] **Step 6: Commit implementation**

```powershell
git add ocr-service/app/schemas.py ocr-service/app/text_eligibility.py ocr-service/scripts/benchmark.py ocr-service/tests/test_text_eligibility.py ocr-service/tests/test_pipeline.py ocr-service/tests/test_benchmark_manifest.py
git commit -m "feat(cleaning): preserve confident sfx"
```

---

### Task 3: Run the Approved Ten-Page Trial

**Files:**
- Create locally, ignored: `ocr-service/benchmark-results/sentence-focused-10/run_targeted.py`
- Generate locally, ignored: report, visual artifacts, and two contact sheets

- [ ] **Step 1: Create the local runner from the existing aggressive runner**

Copy its logic without copying source images. Change:

- output directory to `sentence-focused-10`,
- folders to the two approved paths,
- filenames to `01.webp`–`05.webp` for CieloBivolta and `1.webp`–`5.webp` for Honkai,
- page total to 10,
- contact sheets to two groups of five,
- metrics to `unexpected_unattempted_region_count` and `preserved_sfx_region_count`.

Reports must contain hashes, not external paths.

- [ ] **Step 2: Run the trial**

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe benchmark-results/sentence-focused-10/run_targeted.py
Get-Content benchmark-results/sentence-focused-10/report.md
```

- [ ] **Step 3: Inspect both sheets**

Confirm dialogue/narration/review is cleaned, confident SFX remains, no unexpected unattempted region exists, and no broad patch/artwork damage appears. Open the first sheet in Windows.

- [ ] **Step 4: Run final lean verification**

```powershell
Set-Location ocr-service
.\.venv\Scripts\python.exe -m pytest tests/test_protection.py tests/test_text_eligibility.py tests/test_pipeline.py tests/test_benchmark_manifest.py -q
.\.venv\Scripts\python.exe -m ruff check app/schemas.py app/text_eligibility.py scripts/benchmark.py tests/test_text_eligibility.py tests/test_pipeline.py tests/test_benchmark_manifest.py
git diff --check
git status --short
```

Report tests, commit, runtime, repair pass, preserved SFX, unexpected unattempted regions, protected/outside changes, and visual findings.
