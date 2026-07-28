# Protected, Context-Aware Text Cleaning Implementation Plan

> **Execution mode:** REQUIRED SUB-SKILL: Use superpowers:executing-plans in this task, inline and checkpoint-by-checkpoint. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลบ dialogue, narration/caption ที่ไม่มีบับเบิล และ SFX ที่มั่นใจสูง โดยรักษาเครดิต watermark QR โลโก้ และ UI ทุกพิกเซล

**Architecture:** เพิ่ม page-role, protected-region และ text-role classifiers ก่อน cleaner แล้วคำนวณ `eligible_mask = refined_mask & ~protected_mask`. Pipeline คืน eligible/review/protected masks แยกกัน ตรวจ protected-pixel identity หลังทุก repair และเปิด manual override เฉพาะเมื่อผู้ใช้สั่งชัดเจน

**Tech Stack:** Python 3.12, NumPy, OpenCV, Pillow, Pydantic 2, FastAPI, CTD/AOT ONNX Runtime CPU, Next.js 16.2, React 19.2, TypeScript, Vitest, Pytest

## Global Constraints

- ทำงาน local-only และไม่เรียก paid API
- ใช้ refined CTD pixel mask เป็น deletion mask; OCR/AI box เป็นหลักฐานประกอบเท่านั้น
- หน้า `credits`, `ui`, `unknown` ต้องไม่ถูกคลีนอัตโนมัติ
- narration auto-clean เมื่อ confidence ≥ 0.82
- SFX auto-clean เมื่อ confidence ≥ 0.90
- protected pixels ต้องเหมือน source ทุกช่องสี
- region ก้ำกึ่งต้อง preserve และเป็น `needs_review`
- corpus หลักต้องเป็น `original_comic` ที่มนุษย์รีวิวแล้ว 30 หน้า
- warm median ≤ 30,000 ms; ห้ามใช้ hard timeout ตัดงาน
- ใช้ TDD: fail → minimal implementation → pass → commit
- ทำแบบ Inline Execution พร้อม checkpoint; ห้าม dispatch subagent

---

## File Map

### Python service

- `ocr-service/app/schemas.py`: enums และ API contracts ใหม่
- `ocr-service/app/page_context.py`: page-role features/classifier
- `ocr-service/app/protection.py`: QR, margin/logo และ page-level protection
- `ocr-service/app/text_eligibility.py`: dialogue/narration/SFX eligibility
- `ocr-service/app/pipeline.py`: mask orchestration และ protected invariant
- `ocr-service/app/jobs.py`: assets และ manual action jobs
- `ocr-service/app/api.py`: asset/manual-action endpoints
- `ocr-service/app/cache.py`: cache masks ทั้งสามชนิด
- `ocr-service/tests/test_page_context.py`: page-role tests
- `ocr-service/tests/test_protection.py`: protected-mask tests
- `ocr-service/tests/test_text_eligibility.py`: text-role tests
- `ocr-service/tests/test_pipeline.py`: automatic/manual invariant tests
- `ocr-service/tests/test_api.py`: contracts/assets/action tests

### Web

- `lib/cleaning/types.ts`: mirrored contracts
- `lib/cleaning/client.ts`: mask assets และ manual action client
- `hooks/useCleaning.ts`: object URL lifecycle ของสาม masks
- `components/cleaning/MaskLegend.tsx`: สี/จำนวน region
- `components/cleaning/MaskEditor.tsx`: Force clean/Protect/Automatic
- `src/app/page.tsx`: composite mask layer
- `tests/cleaning/client.test.ts`: decode/action requests
- `tests/cleaning/useCleaning.test.tsx`: URL lifecycle
- `tests/cleaning/MaskEditor.test.tsx`: action controls

### Corpus and acceptance

- `ocr-service/scripts/build_benchmark_manifest.py`: strict path exclusion
- `ocr-service/scripts/review_benchmark_corpus.py`: local contact sheet/label workflow
- `ocr-service/scripts/benchmark.py`: protected and visual gates
- `ocr-service/benchmarks/review-labels.json`: hash-only human labels
- `ocr-service/benchmarks/protected-manifest.json`: protected regression set
- `ocr-service/benchmarks/visual-review.json`: hash-only visual decisions
- `ocr-service/tests/test_benchmark_manifest.py`: privacy/original-only tests
- `docs/cleaning-benchmark.md`: methodology and measured result

---

### Task 1: Extend the shared cleaning contracts

**Files:**
- Modify: `ocr-service/app/schemas.py`
- Modify: `ocr-service/tests/test_schemas.py`
- Modify: `lib/cleaning/types.ts`
- Modify: `tests/cleaning/client.test.ts`

**Interfaces:**
- Produces: `PageRole`, `TextRole`, `AutomaticAction`, `ProtectionReason`, `ManualRegionAction`
- Extends: `RegionRecord`, `CleaningResult`, `CleaningRegion`

- [ ] **Step 1: Write failing Python schema tests**

```python
from app.schemas import (
    AutomaticAction,
    PageRole,
    ProtectionReason,
    RegionRecord,
    RegionStatus,
    TextRole,
)


def test_region_contract_describes_eligibility() -> None:
    record = RegionRecord(
        id="region-1",
        rect={"x": 10, "y": 20, "width": 30, "height": 40},
        route="flat",
        confidence=0.9,
        status=RegionStatus.PRESERVED,
        residual_score=0,
        damage_score=0,
        page_role=PageRole.COMIC,
        text_role=TextRole.NARRATION,
        eligibility_confidence=0.81,
        automatic_action=AutomaticAction.PRESERVE,
        protection_reasons=[ProtectionReason.LOW_CONFIDENCE],
    )
    assert record.automatic_action is AutomaticAction.PRESERVE
```

- [ ] **Step 2: Run the Python test and verify RED**

Run:

```powershell
cd ocr-service
.\.venv\Scripts\pytest tests/test_schemas.py::test_region_contract_describes_eligibility -v
```

Expected: import failure for `PageRole`.

- [ ] **Step 3: Add exact enum and schema fields**

```python
class PageRole(StrEnum):
    COMIC = "comic"
    CREDITS = "credits"
    UI = "ui"
    UNKNOWN = "unknown"


class TextRole(StrEnum):
    DIALOGUE = "dialogue"
    NARRATION = "narration"
    SFX = "sfx"
    PROTECTED = "protected"
    REVIEW = "review"


class AutomaticAction(StrEnum):
    CLEAN = "clean"
    PRESERVE = "preserve"


class ManualRegionAction(StrEnum):
    AUTOMATIC = "automatic"
    FORCE_CLEAN = "force-clean"
    PROTECT = "protect"


class ProtectionReason(StrEnum):
    QR = "qr"
    CREDIT_PAGE = "credit-page"
    UI_PAGE = "ui-page"
    MARGIN_MARK = "margin-mark"
    LOGO = "logo"
    LOW_CONFIDENCE = "low-confidence"
```

Add `PRESERVED = "preserved"` to `RegionStatus`. Add required fields to
`RegionRecord`:

```python
page_role: PageRole
text_role: TextRole
eligibility_confidence: float = Field(ge=0, le=1)
automatic_action: AutomaticAction
protection_reasons: list[ProtectionReason]
```

Add to `CleaningResult`:

```python
review_mask_asset: str
protected_mask_asset: str
```

- [ ] **Step 4: Mirror the contract in TypeScript**

```typescript
export type PageRole = "comic" | "credits" | "ui" | "unknown";
export type TextRole =
  | "dialogue"
  | "narration"
  | "sfx"
  | "protected"
  | "review";
export type AutomaticAction = "clean" | "preserve";
export type ManualRegionAction = "automatic" | "force-clean" | "protect";
export type ProtectionReason =
  | "qr"
  | "credit-page"
  | "ui-page"
  | "margin-mark"
  | "logo"
  | "low-confidence";
```

Add mirrored region fields and `reviewMaskAsset`, `protectedMaskAsset` to
`CleaningResult`. Update test fixtures and `decodeResult`.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_schemas.py -v
cd ..
npm test -- tests/cleaning/client.test.ts
npx tsc --noEmit
```

Commit:

```powershell
git add ocr-service/app/schemas.py ocr-service/tests/test_schemas.py lib/cleaning/types.ts lib/cleaning/client.ts tests/cleaning/client.test.ts
git commit -m "feat(cleaning): classify text eligibility"
```

---

### Task 2: Classify page context and protected regions

**Files:**
- Create: `ocr-service/app/page_context.py`
- Create: `ocr-service/app/protection.py`
- Create: `ocr-service/tests/test_page_context.py`
- Create: `ocr-service/tests/test_protection.py`

**Interfaces:**
- Produces: `PageContext`, `PageFeatures`, `classify_page(image, regions)`
- Produces: `ProtectionResult`, `ProtectedRegion`, `detect_protection(...)`
- Consumes: `RgbImage`, `RefinedMask`, `MaskRegion`, `PageRole`

- [ ] **Step 1: Write failing page-role tests**

```python
def test_qr_heavy_page_is_not_automatic_comic() -> None:
    image = synthetic_credit_page()
    result = classify_page(image, regions=[], qr_polygons=[QR_POLYGON])
    assert result.role is PageRole.CREDITS


def test_panel_art_page_is_comic() -> None:
    image, regions = synthetic_comic_page()
    assert classify_page(image, regions, qr_polygons=[]).role is PageRole.COMIC


def test_ambiguous_blank_page_is_unknown() -> None:
    image = np.full((800, 600, 3), 255, np.uint8)
    assert classify_page(image, [], qr_polygons=[]).role is PageRole.UNKNOWN
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_page_context.py -v
```

Expected: `ModuleNotFoundError: app.page_context`.

- [ ] **Step 3: Implement page features and conservative thresholds**

```python
@dataclass(frozen=True)
class PageFeatures:
    line_art_density: float
    text_coverage: float
    margin_text_fraction: float
    horizontal_band_score: float
    qr_count: int


@dataclass(frozen=True)
class PageContext:
    role: PageRole
    confidence: float
    features: PageFeatures
```

Classification order must be:

1. `qr_count > 0` and `margin_text_fraction >= 0.45` → `credits`
2. `horizontal_band_score >= 0.72` and `text_coverage >= 0.08` → `ui`
3. `line_art_density >= 0.035` and at least one text region → `comic`
4. otherwise → `unknown`

Confidence below `0.70` must return `unknown`.

- [ ] **Step 4: Write failing protection tests**

```python
class FakeQrScanner:
    def detect(self, _image: np.ndarray) -> list[np.ndarray]:
        return [np.array([[20, 20], [60, 20], [60, 60], [20, 60]])]


def test_qr_polygon_is_protected_with_eight_pixel_margin() -> None:
    result = detect_protection(
        np.zeros((100, 100, 3), np.uint8),
        comic_context(),
        [],
        qr_scanner=FakeQrScanner(),
    )
    assert result.protected_mask[12, 12] == 255
    assert result.protected_mask[10, 10] == 0


def test_credit_page_protects_all_detected_text() -> None:
    refined = refined_mask_with_region(x=20, y=20, width=40, height=20)
    result = detect_protection(image(), credit_context(), refined.regions)
    assert np.all(result.protected_mask[20:40, 20:60] == 255)
```

- [ ] **Step 5: Implement protection results**

```python
@dataclass(frozen=True)
class ProtectedRegion:
    rect: PixelRect
    reason: ProtectionReason
    confidence: float


@dataclass(frozen=True)
class ProtectionResult:
    protected_mask: BinaryMask
    review_mask: BinaryMask
    regions: list[ProtectedRegion]
```

Rules:

- QR polygon: hard protected, dilate 8 pixels
- credit/UI page text: hard protected
- unknown page text: review
- compact text component intersecting outer 8% page margin: review with
  `MARGIN_MARK`
- comic interior regions remain unprotected

- [ ] **Step 6: Verify and commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_page_context.py tests/test_protection.py -v
.\.venv\Scripts\ruff check app/page_context.py app/protection.py tests/test_page_context.py tests/test_protection.py
```

Commit:

```powershell
git add ocr-service/app/page_context.py ocr-service/app/protection.py ocr-service/tests/test_page_context.py ocr-service/tests/test_protection.py
git commit -m "feat(cleaning): protect non-content regions"
```

---

### Task 3: Classify dialogue, narration and SFX eligibility

**Files:**
- Create: `ocr-service/app/text_eligibility.py`
- Create: `ocr-service/tests/test_text_eligibility.py`

**Interfaces:**
- Produces: `EligibilityFeatures`, `EligibilityDecision`
- Produces: `classify_eligibility(image, mask, region, page, protection)`
- Consumes: `PageContext`, `ProtectionResult`, `MaskRegion`

- [ ] **Step 1: Write failing role tests**

```python
def test_caption_without_bubble_is_automatic_narration() -> None:
    decision = classify_eligibility(
        *synthetic_rectangular_caption(),
        page=comic_context(),
        protection=empty_protection(),
    )
    assert decision.text_role is TextRole.NARRATION
    assert decision.confidence >= 0.82
    assert decision.action is AutomaticAction.CLEAN


def test_high_confidence_artwork_text_is_sfx() -> None:
    decision = classify_eligibility(
        *synthetic_artwork_sfx(),
        page=comic_context(),
        protection=empty_protection(),
    )
    assert decision.text_role is TextRole.SFX
    assert decision.confidence >= 0.90


def test_margin_text_is_preserved_for_review() -> None:
    decision = classify_eligibility(
        *synthetic_margin_text(),
        page=comic_context(),
        protection=margin_review_protection(),
    )
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role is TextRole.REVIEW
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_text_eligibility.py -v
```

Expected: missing `app.text_eligibility`.

- [ ] **Step 3: Implement explicit features and scoring**

```python
class EligibilityFeatures(BaseModel):
    enclosure_score: float = Field(ge=0, le=1)
    backing_uniformity: float = Field(ge=0, le=1)
    rectangular_backing: float = Field(ge=0, le=1)
    artwork_edge_density: float = Field(ge=0, le=1)
    margin_fraction: float = Field(ge=0, le=1)


class EligibilityDecision(BaseModel):
    text_role: TextRole
    confidence: float = Field(ge=0, le=1)
    action: AutomaticAction
    protection_reasons: list[ProtectionReason]
    features: EligibilityFeatures
```

Decision order:

1. page not `comic` → `protected`/preserve
2. intersects protected mask → `protected`/preserve
3. intersects review mask → `review`/preserve
4. `enclosure_score >= 0.72` → dialogue/clean
5. narration score
   `0.55 * backing_uniformity + 0.45 * rectangular_backing`; clean only
   when ≥ 0.82
6. SFX confidence
   `0.60 * artwork_edge_density + 0.40 * stroke_irregularity`; clean only
   when ≥ 0.90
7. otherwise review/preserve

- [ ] **Step 4: Add boundary tests**

Test exact thresholds `0.819`, `0.820`, `0.899`, `0.900` using injected
feature extractor. The lower values must preserve and boundary values clean.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_text_eligibility.py -v
.\.venv\Scripts\ruff check app/text_eligibility.py tests/test_text_eligibility.py
```

Commit:

```powershell
git add ocr-service/app/text_eligibility.py ocr-service/tests/test_text_eligibility.py
git commit -m "feat(cleaning): gate narration and sfx"
```

---

### Task 4: Enforce masks and manual actions in the pipeline

**Files:**
- Modify: `ocr-service/app/pipeline.py`
- Modify: `ocr-service/tests/test_pipeline.py`
- Modify: `ocr-service/app/compositor.py`
- Modify: `ocr-service/tests/test_compositor.py`

**Interfaces:**
- Extends `PipelineOutput` with `source_image`, `review_mask`,
  `protected_mask`
- Extends `retry_region(..., action: ManualRegionAction)`
- Consumes classifiers from Tasks 2–3

- [ ] **Step 1: Write failing automatic-preservation test**

```python
def test_pipeline_never_changes_protected_pixels() -> None:
    source = random_rgb(160, 120)
    protected = rectangle_mask(source.shape[:2], 20, 20, 40, 30)
    pipeline = pipeline_with_forced_cleaner_change(
        protected_mask=protected,
        eligible_region_overlapping_protection=True,
    )
    output = pipeline.run(source)
    support = protected > 0
    assert np.array_equal(output.clean_image[support], source[support])
    assert not np.any(output.mask[support])
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_pipeline.py::test_pipeline_never_changes_protected_pixels -v
```

Expected: missing `protected_mask` or changed protected pixels.

- [ ] **Step 3: Inject classifiers and build masks once**

Extend constructor:

```python
def __init__(
    self,
    *,
    detector: Detector,
    cleaners: Mapping[str | CleanerRoute, Cleaner],
    refiner: Refiner = refine_mask,
    residual_probe: ResidualProbe | None = None,
    page_classifier: PageClassifier = classify_page,
    protection_detector: ProtectionDetector = detect_protection,
    eligibility_classifier: EligibilityClassifier = classify_eligibility,
) -> None:
```

Before cleaning:

```python
page = self.page_classifier(image_rgb, refined.regions)
protection = self.protection_detector(image_rgb, page, refined.regions)
eligible = np.zeros_like(refined.mask)
review = protection.review_mask.copy()
decisions: dict[str, EligibilityDecision] = {}
for region in refined.regions:
    region_mask = _region_mask(refined.mask, region)
    decision = self.eligibility_classifier(
        image_rgb, region_mask, region, page, protection
    )
    decisions[region.id] = decision
    if decision.action is AutomaticAction.CLEAN:
        eligible = np.maximum(eligible, region_mask)
    elif decision.text_role is TextRole.REVIEW:
        review = np.maximum(review, region_mask)
eligible[protection.protected_mask > 0] = 0
```

Only eligible region masks may reach a cleaner. Preserve records must use
`RegionStatus.PRESERVED`.

- [ ] **Step 4: Enforce protected identity after every candidate**

Add:

```python
def protected_pixels_unchanged(
    source: RgbImage,
    candidate: RgbImage,
    protected_mask: BinaryMask,
) -> bool:
    support = protected_mask > 0
    return bool(np.array_equal(source[support], candidate[support]))
```

If false: restore source pixels, reject that region and record
`needs_review`. Apply this after initial clean, bounded retry and manual
automatic retry.

- [ ] **Step 5: Write failing manual-action tests**

```python
def test_force_clean_is_the_only_action_that_can_override_review() -> None:
    output = preserved_output()
    forced = pipeline.retry_region(
        output, "region-1", user_mask(), "aot",
        ManualRegionAction.FORCE_CLEAN,
    )
    assert forced.regions[0].automatic_action is AutomaticAction.CLEAN


def test_protect_restores_source_pixels() -> None:
    output = repaired_output()
    protected = pipeline.retry_region(
        output, "region-1", user_mask(), "auto",
        ManualRegionAction.PROTECT,
    )
    support = user_mask() > 0
    assert np.array_equal(
        protected.clean_image[support],
        protected.source_image[support],
    )
```

- [ ] **Step 6: Implement manual actions**

- `automatic`: rerun normal classifier and cleaner
- `force-clean`: exact user mask may bypass review/protection because the
  user explicitly requested it; never dilate beyond the submitted mask
- `protect`: restore `source_image` under mask, remove it from eligible mask,
  add it to protected mask

- [ ] **Step 7: Verify and commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_pipeline.py tests/test_compositor.py -v
.\.venv\Scripts\ruff check app/pipeline.py app/compositor.py tests/test_pipeline.py tests/test_compositor.py
```

Commit:

```powershell
git add ocr-service/app/pipeline.py ocr-service/app/compositor.py ocr-service/tests/test_pipeline.py ocr-service/tests/test_compositor.py
git commit -m "feat(cleaning): enforce protected masks"
```

**Checkpoint:** render synthetic dialogue, narration, SFX, QR and margin cases
as a five-column sheet and inspect masks before continuing.

---

### Task 5: Expose mask assets and manual actions through the API

**Files:**
- Modify: `ocr-service/app/jobs.py`
- Modify: `ocr-service/app/api.py`
- Modify: `ocr-service/app/cache.py`
- Modify: `ocr-service/tests/test_api.py`
- Modify: `ocr-service/tests/test_pipeline.py`

**Interfaces:**
- Assets: `clean.png`, `mask.png`, `review-mask.png`, `protected-mask.png`
- Retry form: `mask`, `cleaner`, `action`

- [ ] **Step 1: Write failing API contract tests**

```python
def test_result_exposes_all_mask_assets(client) -> None:
    job_id = submit_and_wait(client, image_bytes())
    result = client.get(f"/v1/jobs/{job_id}/result").json()
    assert result["mask_asset"].endswith("/mask.png")
    assert result["review_mask_asset"].endswith("/review-mask.png")
    assert result["protected_mask_asset"].endswith("/protected-mask.png")


def test_retry_accepts_explicit_protect_action(client) -> None:
    response = client.post(
        f"/v1/jobs/{JOB}/regions/region-1/retry",
        files={"mask": ("mask.png", mask_bytes(), "image/png")},
        data={"cleaner": "auto", "action": "protect"},
    )
    assert response.status_code == 202
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_api.py -v
```

Expected: missing assets and action form.

- [ ] **Step 3: Write all assets atomically**

Update `JobStore._write_assets`:

```python
Image.fromarray(output.clean_image).save(target / "clean.png")
Image.fromarray(output.mask).save(target / "mask.png")
Image.fromarray(output.review_mask).save(target / "review-mask.png")
Image.fromarray(output.protected_mask).save(target / "protected-mask.png")
```

Update `CleaningResult` paths and the asset-name allowlist. Extend
`ResultCache` to store/load the same masks; bump cache pipeline version so old
two-asset entries cannot be restored.

- [ ] **Step 4: Pass validated manual action through JobStore**

`submit_retry` and `RetryablePipeline.retry_region` must receive
`ManualRegionAction`; invalid values return HTTP 422. Parent job must remain
immutable.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_api.py tests/test_pipeline.py -v
.\.venv\Scripts\ruff check app/api.py app/jobs.py app/cache.py tests/test_api.py
```

Commit:

```powershell
git add ocr-service/app/api.py ocr-service/app/jobs.py ocr-service/app/cache.py ocr-service/tests/test_api.py ocr-service/tests/test_pipeline.py
git commit -m "feat(cleaning): expose protected mask assets"
```

---

### Task 6: Add three-color mask review controls to the web app

**Files:**
- Modify: `lib/cleaning/types.ts`
- Modify: `lib/cleaning/client.ts`
- Modify: `hooks/useCleaning.ts`
- Modify: `components/cleaning/MaskEditor.tsx`
- Create: `components/cleaning/MaskLegend.tsx`
- Modify: `src/app/page.tsx`
- Modify: `tests/cleaning/client.test.ts`
- Modify: `tests/cleaning/useCleaning.test.tsx`
- Create: `tests/cleaning/MaskEditor.test.tsx`

**Interfaces:**
- Produces: `PageCleaningResult.reviewMaskUrl`,
  `PageCleaningResult.protectedMaskUrl`
- Produces: `retryRegion(regionId, mask, cleaner, action)`
- Mask colors: red eligible, yellow review, blue protected

- [ ] **Step 1: Write failing URL-lifecycle test**

```tsx
test("hydrates and revokes all cleaning mask URLs", async () => {
  const { result, unmount } = renderHook(() =>
    useCleaning({ pages: ["blob:page"], currentPage: 0 }),
  );
  await act(() => result.current.cleanCurrentPage(sourceBlob));
  expect(result.current.currentResult?.reviewMaskUrl).toBe("blob:review");
  expect(result.current.currentResult?.protectedMaskUrl).toBe("blob:protected");
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:review");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:protected");
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/cleaning/useCleaning.test.tsx
```

Expected: missing mask URLs.

- [ ] **Step 3: Hydrate and revoke four result blobs**

Fetch clean, eligible, review and protected assets concurrently. Revoke all old
URLs on retry, clear and unmount. Do not persist blob URLs.

- [ ] **Step 4: Write failing action-control tests**

```tsx
test("preserved region offers force clean and protect", async () => {
  render(<MaskEditor {...propsForPreservedRegion()} />);
  expect(screen.getByRole("button", { name: "Force clean" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Protect" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Reset to automatic" }),
  ).toBeEnabled();
});
```

- [ ] **Step 5: Render the composite mask and legend**

Use three absolute image layers with `mix-blend-mode: screen`:

- eligible mask: red `rgba(255, 55, 80, .58)`
- review mask: yellow `rgba(255, 190, 40, .58)`
- protected mask: blue `rgba(45, 145, 255, .58)`

`MaskLegend` shows counts by `automaticAction`/`textRole` and the current
`pageRole`. It must remain readable at 360 px width.

- [ ] **Step 6: Send explicit action**

Update client:

```typescript
export async function retryCleaningRegion(
  jobId: string,
  regionId: string,
  mask: Blob,
  cleaner: CleanerOverride,
  action: ManualRegionAction,
): Promise<CleaningJob> {
  const form = new FormData();
  form.append("mask", mask, "mask.png");
  form.append("cleaner", cleaner);
  form.append("action", action);
  return decodeJob(await requestJson(/* existing URL */, {
    method: "POST",
    body: form,
  }));
}
```

Force-clean button copy must warn: “ลบตาม Mask นี้แม้ระบบป้องกันไว้”.

- [ ] **Step 7: Verify browser behavior and commit**

Run:

```powershell
npm test -- tests/cleaning/client.test.ts tests/cleaning/useCleaning.test.tsx tests/cleaning/MaskEditor.test.tsx
npx eslint components/cleaning hooks/useCleaning.ts lib/cleaning tests/cleaning
npx tsc --noEmit
npm run build
```

Browser checkpoint:

1. upload one comic page
2. confirm red/yellow/blue masks align at desktop and 390 px
3. protect a region and confirm clean pixels restore
4. force-clean a review region and confirm only submitted mask changes
5. export and confirm protected marks remain

Commit:

```powershell
git add lib/cleaning hooks/useCleaning.ts components/cleaning src/app/page.tsx tests/cleaning
git commit -m "feat(cleaning): review protected text masks"
```

---

### Task 7: Rebuild an original-only corpus and add visual acceptance

**Files:**
- Modify: `ocr-service/scripts/build_benchmark_manifest.py`
- Create: `ocr-service/scripts/review_benchmark_corpus.py`
- Modify: `ocr-service/scripts/benchmark.py`
- Modify: `ocr-service/benchmarks/manifest.schema.json`
- Replace: `ocr-service/benchmarks/manifest.json`
- Create: `ocr-service/benchmarks/review-labels.json`
- Create: `ocr-service/benchmarks/protected-manifest.json`
- Create: `ocr-service/benchmarks/visual-review.json`
- Modify: `ocr-service/tests/test_benchmark_manifest.py`
- Modify: `docs/cleaning-benchmark.md`
- Modify: `README.md`

**Interfaces:**
- Review labels: `original_comic`, `credits`, `ui`, `translated`, `reject`
- Main manifest accepts only `original_comic`
- Protected manifest accepts `credits`/`ui` and explicit watermark/QR categories

- [ ] **Step 1: Write failing strict-exclusion tests**

```python
@pytest.mark.parametrize(
    "relative",
    [
        "[English]/01.webp",
        "[Chinese]/01.webp",
        "[Thai]/01.webp",
        "ภาษาไทย/01.webp",
        "[中国語版]/01.webp",
    ],
)
def test_language_tagged_paths_are_excluded(relative: str) -> None:
    assert should_include_relative_path(Path(relative)) is False


def test_primary_manifest_contains_only_human_reviewed_originals(manifest) -> None:
    assert len(manifest["pages"]) == 30
    assert {page["review_label"] for page in manifest["pages"]} == {
        "original_comic"
    }
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_benchmark_manifest.py -v
```

Expected: tagged paths included or missing `review_label`.

- [ ] **Step 3: Exclude paths before analysis**

```python
EXCLUDED_PATH_TAGS = (
    "[english]",
    "[chinese]",
    "[thai]",
    "ภาษาไทย",
    "[中国語版]",
)


def should_include_relative_path(relative: Path) -> bool:
    folded = relative.as_posix().casefold()
    return not any(tag.casefold() in folded for tag in EXCLUDED_PATH_TAGS)
```

Call this before opening the image. Do not merely remove tags before hashing.

- [ ] **Step 4: Build the local review workflow**

`review_benchmark_corpus.py --root ... --emit-review-dir
benchmark-results/corpus-review` must write:

- `contact-sheet-*.jpg` with hash prefix only
- `candidates.json` containing hash, dimensions and feature categories only
- `labels.template.json` mapping each hash to `"reject"`

It must not write absolute paths into those artifacts. The reviewer copies
the final hash labels to `benchmarks/review-labels.json`.

- [ ] **Step 5: Rebuild both manifests**

Run:

```powershell
.\.venv\Scripts\python scripts/review_benchmark_corpus.py `
  --root "F:\Doujin\Download" `
  --emit-review-dir benchmark-results/corpus-review
```

Review contact sheets, label hashes, then run:

```powershell
.\.venv\Scripts\python scripts/build_benchmark_manifest.py `
  --root "F:\Doujin\Download" `
  --review-labels benchmarks/review-labels.json `
  --count 30
```

Stop if fewer than 30 unique `original_comic` pages exist. Build
`protected-manifest.json` with at least 10 reviewed credit/UI/QR/watermark
pages.

- [ ] **Step 6: Write failing visual-gate tests**

```python
def test_visual_review_has_required_coverage(visual_review) -> None:
    passed = [item for item in visual_review["pages"] if item["decision"] == "pass"]
    assert len(passed) >= 12
    categories = Counter(
        category for item in passed for category in item["categories"]
    )
    assert categories["dialogue"] >= 3
    assert categories["narration"] >= 3
    assert categories["sfx"] >= 3
    assert categories["protected-heavy"] >= 3
```

- [ ] **Step 7: Generate five-column visual artifacts**

For the 12 selected hashes, benchmark writes ignored local images:

```text
Original | Clean | Eligible Mask | Protected Mask | Difference x5
```

`visual-review.json` stores only hash, categories, decision and a short reason.
Acceptance fails if a required decision is missing or not `pass`.

- [ ] **Step 8: Run full acceptance**

Run:

```powershell
.\.venv\Scripts\python scripts/benchmark.py `
  --root "F:\Doujin\Download" `
  --manifest benchmarks/manifest.json `
  --protected-manifest benchmarks/protected-manifest.json `
  --visual-review benchmarks/visual-review.json `
  --cleaner aot `
  --regression-page "E:\SuperK\SuperK_Page_001_1.webp" `
  --regression-page "E:\SuperK\SuperK_Page_001_2.webp"
```

Required PASS:

- median ≤ 30,000 ms
- residual ≥ 95%
- automatic eligible-region pass ≥ 90%
- changed outside support = 0
- changed inside protected mask = 0
- credit/UI pixel identity = 100%
- text-free pixel identity = 100%
- rectangular patch pass
- visual review coverage and all 12 decisions pass

- [ ] **Step 9: Full verification and commit**

Run:

```powershell
.\.venv\Scripts\pytest tests -v
.\.venv\Scripts\ruff check app scripts tests
cd ..
npm test
npx tsc --noEmit
npm run build
rg -n "cv\.worker|inpainted-bg|brightness\s*[<>]" lib/translationOverlay.ts
git diff --check
```

Expected: all commands pass; `rg` returns no matches.

Update docs with measured median, p95, protected identity and visual results.

Commit:

```powershell
git add ocr-service/benchmarks ocr-service/scripts ocr-service/tests/test_benchmark_manifest.py docs/cleaning-benchmark.md README.md
git commit -m "test(cleaning): gate protected text quality"
```

**Final checkpoint:** do not merge until the user sees the 12 visual sheets and
approves the result.

---

## Inline Execution Order

1. Batch A: Tasks 1–2 → contract and protection checkpoint
2. Batch B: Tasks 3–4 → synthetic visual checkpoint
3. Batch C: Tasks 5–6 → API/browser checkpoint
4. Batch D: Task 7 → corpus review and measured acceptance

Every batch stops only for a material design conflict, failed visual gate, or
authority needed outside the approved local files. Otherwise continue
automatically.
