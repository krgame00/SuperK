# แผนพัฒนาระบบคลีนข้อความมังงะแบบไฮบริดของ SuperK

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มระบบคลีนข้อความฟรีที่ทำงานในเครื่อง แยก mask ระดับพิกเซล เลือกวิธีซ่อมตามพื้นหลัง และเชื่อมเข้ากับเว็บอัปโหลดของ SuperK โดยตั้งเป้าเวลามัธยฐานไม่เกิน 30 วินาทีต่อหน้า

**Architecture:** แยก Python/FastAPI vision service ไว้ใต้ `ocr-service/` และให้ Next.js Route Handler ทำหน้าที่ proxy ไปยัง service ในเครื่อง ตัว engine ใช้ CTD ONNX สร้าง text mask, ใช้ตัวซ่อมแบบ deterministic สำหรับพื้นเรียบ/gradient และใช้ AOT ONNX หรือ AnimeLaMa เฉพาะ artwork crop หน้าเว็บเก็บ Original, Clean และ Mask เป็นคนละ layer และวางข้อความแปลแยกจนกว่าจะ export

**Tech Stack:** Python 3.11+, FastAPI, Pydantic 2, NumPy, OpenCV, ONNX Runtime CPU, Pillow, PyTorch เฉพาะ optional AnimeLaMa benchmark, Next.js 16.2 App Router, React 19.2, TypeScript, Vitest และ React Testing Library

## Global Constraints

- ระบบคลีนต้องทำงาน local-only และไม่เรียก paid API
- เครื่องเป้าหมายคือ AMD Ryzen 5 5600G, RAM 31 GB และไม่มี NVIDIA GPU
- เวลามัธยฐานแบบ warm ต้องไม่เกิน 30 วินาทีต่อหน้า โดยไม่ใช้ hard timeout ตัดงาน
- ห้ามใช้ OCR/Gemini bounding box เป็น deletion mask โดยตรง
- พิกเซลนอก refined mask และ feather support ต้องไม่เปลี่ยน
- หน้าที่ไม่มีข้อความต้องคืนภาพแบบ lossless และเหมือนต้นฉบับทุกพิกเซล
- โมเดลและ virtual environment ห้าม commit เข้า Git
- CTD/AOT baseline ใช้โมเดล GPL-3.0 จาก `lemondouble/lemon-manga-translator`; service และเอกสารแจกจ่ายต้องรักษา notice และปฏิบัติตาม GPL
- AnimeLaMa benchmark ใช้ TorchScript จาก `df1412/anime-big-lama` ซึ่ง model card ระบุ MIT; ห้ามเปิดใช้เป็นค่าเริ่มต้นจนกว่า benchmark และ license record ผ่าน
- ใช้ Next.js Route Handlers ใต้ `src/app/api/`; handler ที่อ่าน request หรือเรียก local service เป็น dynamic และไม่ cache
- ทำ TDD ทุก task: เขียน test ให้ fail, ยืนยัน fail, implement ขั้นต่ำ, ยืนยัน pass แล้วจึง commit
- ห้ามแก้หรือ commit งานค้างที่ไม่เกี่ยวข้องใน worktree

---

## File Map

### Python service

- `ocr-service/requirements.in`: runtime dependency constraints
- `ocr-service/requirements-dev.in`: test/lint dependency constraints
- `ocr-service/requirements.lock`: dependency lock พร้อม hashes
- `ocr-service/app/schemas.py`: enum และ Pydantic contract กลาง
- `ocr-service/app/settings.py`: path, threshold และ environment settings
- `ocr-service/app/model_store.py`: model manifest, download และ checksum verification
- `ocr-service/app/detector.py`: CTD ONNX preprocessing/inference/postprocessing
- `ocr-service/app/mask_refiner.py`: component filtering, dilation และ protected edges
- `ocr-service/app/region_router.py`: feature extraction และ route classification
- `ocr-service/app/cleaners/base.py`: cleaner protocol
- `ocr-service/app/cleaners/flat.py`: flat/gradient reconstruction
- `ocr-service/app/cleaners/aot.py`: AOT ONNX artwork cleaner
- `ocr-service/app/cleaners/anime_lama.py`: optional AnimeLaMa adapter
- `ocr-service/app/compositor.py`: masked composition และ feather support
- `ocr-service/app/residual_probe.py`: CTD crop probe และ optional OCR evidence adapter
- `ocr-service/app/verifier.py`: residual/damage scoring
- `ocr-service/app/cache.py`: content-addressed result cache
- `ocr-service/app/pipeline.py`: orchestration และ bounded retry
- `ocr-service/app/jobs.py`: thread-safe asynchronous job store
- `ocr-service/app/api.py`: FastAPI application และ binary assets
- `ocr-service/models/manifest.json`: pinned model metadata, URL, SHA-256 และ license
- `ocr-service/scripts/install_models.py`: explicit offline-model installer
- `ocr-service/scripts/build_benchmark_manifest.py`: สร้าง manifest จาก `F:\Doujin\Download`
- `ocr-service/scripts/benchmark.py`: วัดคุณภาพและเวลา
- `ocr-service/THIRD_PARTY_MODELS.md`: source/license/checksum notices
- `ocr-service/tests/`: unit, API, integration และ benchmark-contract tests

### Next.js application

- `src/app/api/clean/[...path]/route.ts`: no-store proxy ไป local vision service
- `lib/cleaning/types.ts`: TypeScript contract ที่ตรงกับ Pydantic schema
- `lib/cleaning/client.ts`: create/poll/result/retry client
- `lib/cleaning/maskEdits.ts`: pure brush/eraser mask operations
- `hooks/useCleaning.ts`: per-page cleaning state และ object URL lifecycle
- `components/cleaning/CleaningToolbar.tsx`: เริ่มงาน, layer toggle, progress และ error recovery
- `components/cleaning/MaskEditor.tsx`: canvas mask editor และ region override
- `lib/projectStore.ts`: persist cleaning metadata โดยไม่เก็บ model/cache binary
- `lib/translationOverlay.ts`: render/export text บน clean image โดยไม่ inpaint ใน browser
- `src/app/page.tsx`: ต่อ hook/components เข้ากับ workspace
- `vitest.config.mts`, `tests/setup.ts`, `tests/cleaning/`: frontend unit/component tests

---

## Phase 1: Local Cleaning Engine

### Task 1: สร้าง Python Project และ Contract กลาง

**Files:**
- Modify: `.gitignore`
- Create: `ocr-service/requirements.in`
- Create: `ocr-service/requirements-dev.in`
- Create: `ocr-service/app/__init__.py`
- Create: `ocr-service/app/schemas.py`
- Create: `ocr-service/app/settings.py`
- Create: `ocr-service/tests/test_schemas.py`

**Interfaces:**
- Produces: `CleanerRoute`, `RegionStatus`, `JobStatus`, `JobStage`, `PixelRect`, `RegionRecord`, `JobProgress`, `CleaningResult`, `Settings`
- `PixelRect` ใช้พิกัด source-image แบบ integer: `x`, `y`, `width`, `height`
- `CleaningResult.clean_asset` และ `mask_asset` เป็น path ภายใน service ไม่ใช่ filesystem path

- [ ] **Step 1: เพิ่ม ignore rules และ dependency inputs**

เพิ่ม:

```gitignore
/ocr-service/venv/
/ocr-service/.venv/
/ocr-service/models/*.onnx
/ocr-service/models/*.ckpt
/ocr-service/models/*.pt
/ocr-service/.cache/
/ocr-service/benchmark-results/
```

สร้าง `requirements.in`:

```text
fastapi>=0.116,<1
uvicorn[standard]>=0.35,<1
python-multipart>=0.0.20,<1
pydantic>=2.11,<3
pydantic-settings>=2.10,<3
numpy>=2.2,<3
opencv-python-headless>=4.11,<5
pillow>=11,<12
onnxruntime>=1.22,<2
huggingface-hub>=0.34,<1
```

สร้าง `requirements-dev.in`:

```text
-r requirements.in
pytest>=8.4,<9
pytest-cov>=6,<7
httpx>=0.28,<1
ruff>=0.12,<1
pip-tools>=7.5,<8
```

- [ ] **Step 2: เขียน failing schema tests**

```python
from pydantic import ValidationError
from app.schemas import CleanerRoute, CleaningResult, PixelRect


def test_pixel_rect_rejects_non_positive_size() -> None:
    try:
        PixelRect(x=0, y=0, width=0, height=10)
    except ValidationError:
        return
    raise AssertionError("zero-width rect must be rejected")


def test_cleaning_result_uses_stable_asset_paths() -> None:
    result = CleaningResult(
        job_id="job-1",
        source_hash="a" * 64,
        width=1200,
        height=1800,
        clean_asset="/v1/jobs/job-1/assets/clean.png",
        mask_asset="/v1/jobs/job-1/assets/mask.png",
        regions=[],
        timings_ms={"total": 1234},
    )
    assert result.clean_asset.endswith("/clean.png")
    assert CleanerRoute.ARTWORK.value == "artwork"
```

- [ ] **Step 3: รัน test ให้ยืนยันว่า fail**

Run:

```powershell
cd ocr-service
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -U pip pip-tools
.\.venv\Scripts\pip-compile --generate-hashes requirements-dev.in -o requirements.lock
.\.venv\Scripts\pip-sync requirements.lock
.\.venv\Scripts\pytest tests/test_schemas.py -v
```

Expected: FAIL ด้วย `ModuleNotFoundError: No module named 'app.schemas'`

- [ ] **Step 4: Implement schema และ settings ขั้นต่ำ**

`schemas.py` ต้องประกาศ:

```python
from enum import StrEnum
from pydantic import BaseModel, Field


class CleanerRoute(StrEnum):
    FLAT = "flat"
    GRADIENT = "gradient"
    ARTWORK = "artwork"


class RegionStatus(StrEnum):
    READY = "ready"
    REPAIRED = "repaired"
    NEEDS_REVIEW = "needs_review"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class JobStage(StrEnum):
    QUEUED = "queued"
    DETECTING = "detecting"
    REFINING = "refining"
    CLEANING = "cleaning"
    VERIFYING = "verifying"
    ENCODING = "encoding"
    COMPLETE = "complete"


class PixelRect(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class RegionRecord(BaseModel):
    id: str
    rect: PixelRect
    route: CleanerRoute
    confidence: float = Field(ge=0, le=1)
    status: RegionStatus
    residual_score: float = Field(ge=0)
    damage_score: float = Field(ge=0)


class CleaningResult(BaseModel):
    job_id: str
    source_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    clean_asset: str
    mask_asset: str
    regions: list[RegionRecord]
    timings_ms: dict[str, int]
```

`settings.py` ใช้ `BaseSettings` และกำหนด `model_dir`, `cache_dir`, `max_workers=1`, `max_upload_mb=80`, `service_url`.

- [ ] **Step 5: รัน test/lint และ commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_schemas.py -v
.\.venv\Scripts\ruff check app tests
```

Expected: PASS ทั้งหมด

Commit:

```powershell
git add .gitignore ocr-service/requirements.in ocr-service/requirements-dev.in ocr-service/requirements.lock ocr-service/app ocr-service/tests/test_schemas.py
git commit -m "feat(cleaning): add service contracts"
```

---

### Task 2: Model Manifest, Installer และ License Record

**Files:**
- Create: `ocr-service/models/manifest.json`
- Create: `ocr-service/app/model_store.py`
- Create: `ocr-service/scripts/install_models.py`
- Create: `ocr-service/THIRD_PARTY_MODELS.md`
- Create: `ocr-service/tests/test_model_store.py`

**Interfaces:**
- Produces: `ModelSpec`, `ModelStore.ensure(model_id: str) -> Path`, `sha256_file(path: Path) -> str`
- Model IDs: `ctd-onnx`, `aot-onnx`, `anime-lama`
- ไม่มี network call ตอน import; download เกิดจาก installer หรือ `ensure()` เท่านั้น

- [ ] **Step 1: เขียน failing checksum tests**

```python
import hashlib
from pathlib import Path
import pytest
from app.model_store import ChecksumMismatch, ModelSpec, ModelStore


def test_model_store_accepts_matching_file(tmp_path: Path) -> None:
    payload = b"model-bytes"
    digest = hashlib.sha256(payload).hexdigest()
    target = tmp_path / "model.onnx"
    target.write_bytes(payload)
    store = ModelStore(tmp_path, {"test": ModelSpec("test", "", digest, "MIT", "model.onnx")})
    assert store.ensure("test") == target


def test_model_store_rejects_wrong_checksum(tmp_path: Path) -> None:
    (tmp_path / "model.onnx").write_bytes(b"wrong")
    store = ModelStore(
        tmp_path,
        {"test": ModelSpec("test", "", "0" * 64, "MIT", "model.onnx")},
    )
    with pytest.raises(ChecksumMismatch):
        store.ensure("test")
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `.\.venv\Scripts\pytest tests/test_model_store.py -v`

Expected: FAIL เพราะยังไม่มี `app.model_store`

- [ ] **Step 3: สร้าง manifest แบบ pinned**

`manifest.json` ต้องบันทึก:

```json
{
  "ctd-onnx": {
    "url": "https://huggingface.co/lemondouble/lemon-manga-translator/resolve/e8c08f38f188db684fdc32c4cf88627c7df92096/onnx/comic-text-detector/ctd.onnx",
    "sha256": "eea9f9ccad2364fcb15bdfeca25268be273fea80b111ba6a6f4c03f556c24c26",
    "filename": "ctd.onnx",
    "license": "GPL-3.0-only"
  },
  "aot-onnx": {
    "url": "https://huggingface.co/lemondouble/lemon-manga-translator/resolve/e8c08f38f188db684fdc32c4cf88627c7df92096/onnx/aot-inpainting/aot_folded.onnx",
    "sha256": "e0d8f438ca9567eccc9d358963427601b6f64a650cbe6189ec82fc43830a0390",
    "filename": "aot_folded.onnx",
    "license": "GPL-3.0-only"
  },
  "anime-lama": {
    "url": "https://huggingface.co/df1412/anime-big-lama/resolve/main/anime-manga-big-lama.pt",
    "sha256": "479d3afdcb7ed2fd944ed4ebcc39ca45b33491f0f2e43eb1000bd623cfb41823",
    "filename": "anime-manga-big-lama.pt",
    "license": "MIT"
  }
}
```

`install_models.py` ต้องรองรับ `--baseline` สำหรับ CTD+AOT และ `--include-anime-lama` สำหรับโมเดล optional พร้อมเขียน `.part` แล้ว rename หลัง checksum ผ่านเท่านั้น

- [ ] **Step 4: Implement store และ notice**

`ModelStore.ensure()` ทำตามลำดับ:

1. ตรวจ model ID
2. ถ้าไฟล์มีอยู่ให้ตรวจ SHA-256
3. ถ้า checksum ผิดให้ throw โดยไม่ลบไฟล์
4. ถ้าไม่มีไฟล์ให้ download ไป `.part`
5. ตรวจ checksum แล้ว `Path.replace()` เป็นชื่อจริง

`THIRD_PARTY_MODELS.md` ต้องระบุ source URL, pinned revision, SHA-256, license และคำเตือนว่า baseline service มี GPL dependency.

- [ ] **Step 5: Verify และ commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_model_store.py -v
.\.venv\Scripts\ruff check app scripts tests
```

Expected: PASS โดย test ไม่ดาวน์โหลด network

Commit:

```powershell
git add ocr-service/models/manifest.json ocr-service/app/model_store.py ocr-service/scripts/install_models.py ocr-service/THIRD_PARTY_MODELS.md ocr-service/tests/test_model_store.py
git commit -m "feat(cleaning): add verified model installer"
```

---

### Task 3: CTD ONNX Detector Adapter

**Files:**
- Create: `ocr-service/app/detector.py`
- Create: `ocr-service/tests/test_detector.py`
- Create: `ocr-service/tests/fixtures/detector_page.png`

**Interfaces:**
- Consumes: `ModelStore.ensure("ctd-onnx")`
- Produces: `DetectionResult(mask_probability: np.ndarray, blocks: list[DetectedBlock], scale: LetterboxTransform)`
- `TextDetector.detect(image_rgb: np.ndarray) -> DetectionResult`
- `mask_probability` มี shape เท่าภาพต้นฉบับและ dtype `float32`

- [ ] **Step 1: เขียน failing geometry tests**

```python
import numpy as np
from app.detector import LetterboxTransform, restore_mask


def test_restore_mask_removes_letterbox_padding() -> None:
    transform = LetterboxTransform(
        source_width=400,
        source_height=200,
        input_size=1024,
        scale=2.56,
        pad_x=0,
        pad_y=256,
    )
    model_mask = np.zeros((1024, 1024), dtype=np.float32)
    model_mask[256:768, :] = 1.0
    restored = restore_mask(model_mask, transform)
    assert restored.shape == (200, 400)
    assert float(restored.min()) > 0.99
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `.\.venv\Scripts\pytest tests/test_detector.py -v`

Expected: FAIL เพราะยังไม่มี `LetterboxTransform`

- [ ] **Step 3: Implement preprocessing และ pure postprocessing**

สร้าง:

```python
@dataclass(frozen=True)
class LetterboxTransform:
    source_width: int
    source_height: int
    input_size: int
    scale: float
    pad_x: int
    pad_y: int


@dataclass(frozen=True)
class DetectedBlock:
    rect: PixelRect
    confidence: float


@dataclass(frozen=True)
class DetectionResult:
    mask_probability: np.ndarray
    blocks: list[DetectedBlock]
    scale: LetterboxTransform
```

Preprocess เป็น RGB, letterbox 1024×1024, normalize เป็น `float32 / 255`, transpose เป็น NCHW และ batch dimension 1.

Port เฉพาะ NumPy NMS และ CTD output decoding ที่ต้องใช้จาก `lemon-manga-translator==0.0.17`; ใส่ SPDX/source comment ที่หัวส่วน port และห้ามนำ translation/rendering code มาด้วย.

- [ ] **Step 4: เพิ่ม model smoke test แบบ opt-in**

```python
@pytest.mark.model
def test_ctd_model_returns_source_sized_mask(model_store: ModelStore) -> None:
    image = np.asarray(Image.open("tests/fixtures/detector_page.png").convert("RGB"))
    result = TextDetector(model_store).detect(image)
    assert result.mask_probability.shape == image.shape[:2]
    assert 0.0 <= float(result.mask_probability.min())
    assert float(result.mask_probability.max()) <= 1.0
```

รัน unit tests ปกติโดยไม่ใช้โมเดล และรัน smoke test หลัง `install_models.py --baseline`.

- [ ] **Step 5: Verify และ commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_detector.py -v -m "not model"
.\.venv\Scripts\python scripts/install_models.py --baseline
.\.venv\Scripts\pytest tests/test_detector.py -v -m model
```

Expected: unit และ model smoke test PASS; mask มีขนาดเท่าภาพ source

Commit:

```powershell
git add ocr-service/app/detector.py ocr-service/tests/test_detector.py ocr-service/tests/fixtures/detector_page.png
git commit -m "feat(cleaning): add CTD mask detector"
```

---

### Task 4: Mask Refinement, Protected Edges และ Region Grouping

**Files:**
- Create: `ocr-service/app/mask_refiner.py`
- Create: `ocr-service/tests/test_mask_refiner.py`

**Interfaces:**
- Consumes: `DetectionResult`
- Produces: `RefinedMask(mask: np.ndarray[uint8], regions: list[MaskRegion], protected_edges: np.ndarray[uint8])`
- `refine_mask(image_rgb, detection, config) -> RefinedMask`
- `MaskRegion` มี `id`, `rect`, `component_ids`, `stroke_radius`

- [ ] **Step 1: เขียน failing tests สำหรับ contour dilation และ edge protection**

```python
def test_dilation_follows_glyph_not_full_box() -> None:
    probability = np.zeros((40, 80), np.float32)
    probability[15:25, 20:23] = 1
    probability[15:25, 30:33] = 1
    result = refine_probability_mask(probability, np.zeros((40, 80), np.uint8), threshold=0.5)
    assert result.mask[20, 25] == 0
    assert result.mask.sum() < 400


def test_mask_growth_stops_at_protected_edge() -> None:
    seed = np.zeros((30, 30), np.uint8)
    seed[12:18, 8:11] = 255
    edge = np.zeros_like(seed)
    edge[:, 13] = 255
    grown = constrained_dilate(seed, edge, radius=5)
    assert grown[:, 14:].sum() == 0
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `.\.venv\Scripts\pytest tests/test_mask_refiner.py -v`

Expected: FAIL เพราะฟังก์ชันยังไม่มี

- [ ] **Step 3: Implement refinement**

ใช้:

- threshold เริ่มต้น `0.45`
- connected components 8-connectivity
- กรอง component ต่ำกว่า `max(6, image_area * 0.000002)`
- ประเมิน stroke radius จาก distance transform แล้ว clamp `2..4`
- สร้าง protected edges ด้วย Canny บน luminance และลบ edge ที่ทับ high-confidence text probability `>=0.8`
- ขยายด้วย iteration ทีละ 1 พิกเซลและตัด protected edge ทุก iteration
- รวม region เมื่อ rect distance ไม่เกิน `1.5 × median glyph height` และ orientation สอดคล้องกัน

- [ ] **Step 4: เพิ่ม coordinate/property tests**

สุ่ม binary glyph mask 100 ชุดด้วย fixed seed `20260727` และ assert ว่า:

- refined mask ไม่ออกนอกภาพ
- ทุก seed pixel อยู่ใน refined mask
- region rect ครอบ mask ของ region
- ไม่มี full-box fill เมื่อ seed coverage ต่ำกว่า 25%

- [ ] **Step 5: Verify และ commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_mask_refiner.py -v
.\.venv\Scripts\ruff check app tests
```

Expected: PASS

Commit:

```powershell
git add ocr-service/app/mask_refiner.py ocr-service/tests/test_mask_refiner.py
git commit -m "feat(cleaning): refine glyph masks"
```

---

### Task 5: Region Router และ Deterministic Cleaners

**Files:**
- Create: `ocr-service/app/region_router.py`
- Create: `ocr-service/app/cleaners/__init__.py`
- Create: `ocr-service/app/cleaners/base.py`
- Create: `ocr-service/app/cleaners/flat.py`
- Create: `ocr-service/tests/test_region_router.py`
- Create: `ocr-service/tests/test_flat_cleaner.py`

**Interfaces:**
- Produces: `Cleaner` protocol: `clean(image_rgb, mask, region) -> np.ndarray`
- Produces: `RegionFeatures` และ `route_region(image_rgb, mask, region) -> RouteDecision`
- `RouteDecision` มี `route`, `confidence`, `features`

- [ ] **Step 1: เขียน failing route tests**

```python
def test_uniform_white_region_routes_flat() -> None:
    image = np.full((64, 64, 3), 248, np.uint8)
    mask = glyph_mask((64, 64))
    decision = route_region(image, mask, full_region())
    assert decision.route is CleanerRoute.FLAT
    assert decision.confidence >= 0.8


def test_edge_dense_region_routes_artwork() -> None:
    image = checkerboard_rgb(64, 64, tile=2)
    mask = glyph_mask((64, 64))
    decision = route_region(image, mask, full_region())
    assert decision.route is CleanerRoute.ARTWORK
```

- [ ] **Step 2: เขียน failing cleaner invariant tests**

```python
def test_flat_cleaner_changes_only_mask_support() -> None:
    original = gradient_rgb(80, 80)
    mask = glyph_mask((80, 80))
    result = FlatCleaner().clean(original, mask, full_region())
    assert np.array_equal(result[mask == 0], original[mask == 0])
    assert not np.array_equal(result[mask > 0], original[mask > 0])
```

- [ ] **Step 3: Implement feature/router**

คำนวณ feature จาก ring กว้าง 8 พิกเซลรอบ mask:

```python
class RegionFeatures(BaseModel):
    lab_variance: float
    edge_density: float
    entropy: float
    gradient_coherence: float
    line_art_fraction: float
```

กฎเริ่มต้น:

- `FLAT`: `lab_variance < 18`, `edge_density < 0.08`
- `GRADIENT`: `lab_variance < 45`, `edge_density < 0.18`, `gradient_coherence >= 0.55`
- นอกนั้น `ARTWORK`

Confidence คือระยะ normalized จาก decision boundary และ clamp `0..1`.

- [ ] **Step 4: Implement Flat/Gradient cleaner**

`FlatCleaner` ใช้ median Lab จาก ring และ optional least-squares plane ต่อ channel เมื่อ gradient coherence ผ่านเกณฑ์.

`GradientCleaner` รัน `cv2.inpaint(..., cv2.INPAINT_TELEA)` ที่ radius `2`, `3`, `5` แล้วเลือก candidate ที่มี boundary gradient error ต่ำสุด. ทุก cleaner คืน full-size array แต่เปลี่ยนเฉพาะ mask support.

- [ ] **Step 5: Verify และ commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_region_router.py tests/test_flat_cleaner.py -v
```

Expected: PASS และ invariant นอก mask เป็น byte-identical

Commit:

```powershell
git add ocr-service/app/region_router.py ocr-service/app/cleaners ocr-service/tests/test_region_router.py ocr-service/tests/test_flat_cleaner.py
git commit -m "feat(cleaning): route deterministic repairs"
```

---

### Task 6: Artwork Cleaners และ CPU Selection Gate

**Files:**
- Create: `ocr-service/app/cleaners/aot.py`
- Create: `ocr-service/app/cleaners/anime_lama.py`
- Create: `ocr-service/tests/test_artwork_cleaners.py`

**Interfaces:**
- Consumes: `Cleaner` protocol และ `ModelStore`
- Produces: `AotCleaner`, `AnimeLamaCleaner`
- ทั้งสอง class ต้องรับ source crop/mask และคืน crop ขนาดเดิม
- Runtime default เริ่มต้นเป็น `AotCleaner`; เปลี่ยนเป็น AnimeLaMa ได้ผ่าน `SUPERK_ARTWORK_CLEANER=anime-lama` หลัง benchmark เท่านั้น

- [ ] **Step 1: เขียน failing preprocessing tests**

```python
def test_aot_padding_is_multiple_of_eight() -> None:
    image = np.zeros((513, 517, 3), np.uint8)
    mask = np.zeros((513, 517), np.uint8)
    tensor, mask_tensor, transform = prepare_aot_inputs(image, mask)
    assert tensor.shape[-2] % 8 == 0
    assert tensor.shape[-1] % 8 == 0
    assert restore_aot_output(tensor, transform).shape[:2] == image.shape[:2]


def test_artwork_cleaner_preserves_unmasked_pixels(fake_session) -> None:
    image = sample_artwork()
    mask = glyph_mask(image.shape[:2])
    output = AotCleaner(fake_session).clean(image, mask, full_region())
    assert np.array_equal(output[mask == 0], image[mask == 0])
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `.\.venv\Scripts\pytest tests/test_artwork_cleaners.py -v`

Expected: FAIL เพราะ adapter ยังไม่มี

- [ ] **Step 3: Implement AOT ONNX**

- Crop เพิ่ม context 96 พิกเซลและ clamp อยู่ในภาพ
- Pad H/W เป็นจำนวนที่หาร 8 ลงตัว
- Normalize RGB ไปช่วง `[-1, 1]`
- Normalize mask เป็น `0/1`
- ใช้ `onnxruntime.SessionOptions(enable_cpu_mem_arena=False)`
- จำกัด `intra_op_num_threads` เป็น `min(6, os.cpu_count() or 1)`
- Restore ขนาดเดิมและ composite เฉพาะ mask

- [ ] **Step 4: Implement optional AnimeLaMa adapter**

แยก optional dependency เป็น `ocr-service/requirements-lama.in`:

```text
-r requirements.in
torch>=2.7,<3
```

โหลด checkpoint ด้วย CPU, `eval()` และ `torch.inference_mode()`. ห้ามโหลด pickle checkpoint เมื่อ SHA-256 ไม่ตรง manifest. หาก dependency ไม่มี ให้ raise `CleanerUnavailable("anime-lama requires requirements-lama.lock")`.

ใช้ `torch.jit.load(model_path, map_location="cpu")` เพราะไฟล์เป็น TorchScript และ compile optional lock ด้วย:

```powershell
.\.venv\Scripts\pip-compile --generate-hashes requirements-lama.in -o requirements-lama.lock
```

- [ ] **Step 5: Verify model smoke tests และ commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_artwork_cleaners.py -v -m "not model"
.\.venv\Scripts\pytest tests/test_artwork_cleaners.py -v -m model
```

Expected: AOT model smoke test PASS; AnimeLaMa test skip อย่างมีเหตุผลหากยังไม่ได้ติดตั้ง optional lock

Commit:

```powershell
git add ocr-service/app/cleaners/aot.py ocr-service/app/cleaners/anime_lama.py ocr-service/requirements-lama.in ocr-service/tests/test_artwork_cleaners.py
git commit -m "feat(cleaning): add artwork cleaners"
```

---

### Task 7: Compositor, Verifier, Cache และ Pipeline

**Files:**
- Create: `ocr-service/app/compositor.py`
- Create: `ocr-service/app/residual_probe.py`
- Create: `ocr-service/app/verifier.py`
- Create: `ocr-service/app/cache.py`
- Create: `ocr-service/app/pipeline.py`
- Create: `ocr-service/tests/test_compositor.py`
- Create: `ocr-service/tests/test_verifier.py`
- Create: `ocr-service/tests/test_pipeline.py`

**Interfaces:**
- `compose(original, repaired, mask, feather_radius=2) -> np.ndarray`
- `CompositeResidualProbe.score(cleaned_crop, source_mask, ocr_probe=None) -> float`
- `verify_region(original, cleaned, source_mask, support_mask, region, residual_probe) -> VerificationReport`
- `CleaningPipeline.run(image_rgb, progress_callback) -> PipelineOutput`
- `PipelineOutput` มี clean image, combined mask, regions และ timings

- [ ] **Step 1: เขียน failing composition/damage tests**

```python
def test_compositor_is_identical_outside_support() -> None:
    original = seeded_noise_rgb(96, 96, seed=20260727)
    repaired = np.full_like(original, 127)
    mask = glyph_mask((96, 96))
    result, support = compose(original, repaired, mask, feather_radius=2)
    assert np.array_equal(result[support == 0], original[support == 0])


def test_verifier_rejects_change_outside_support() -> None:
    original = np.zeros((32, 32, 3), np.uint8)
    changed = original.copy()
    changed[0, 0] = 255
    report = verify_damage(original, changed, np.zeros((32, 32), np.uint8))
    assert report.accepted is False
```

- [ ] **Step 2: Implement verifier thresholds**

`VerificationReport` ต้องมี:

```python
class VerificationReport(BaseModel):
    residual_score: float
    damage_score: float
    accepted: bool
    retry_mask_radius: int | None
```

- residual score = รัน CTD ซ้ำบน cleaned crop แล้วรวม mean probability ภายใน original mask กับ normalized count ของ stroke-like components
- หากมี OCR adapter ที่รองรับ source script ให้ `CompositeResidualProbe` รวม OCR confidence ด้วยน้ำหนัก `0.25`; เมื่อไม่มี OCR ให้ normalize น้ำหนัก CTD+stroke กลับเป็น `1.0`
- damage score = changed-pixel ratio นอก support + boundary-gradient error
- retry เมื่อ residual `>0.18` และ damage `<=0.02`
- reject เมื่อมีพิกเซลเปลี่ยนนอก support หรือ boundary-gradient error `>0.25`

- [ ] **Step 3: Implement cache**

Cache key:

```python
sha256(
    source_bytes
    + pipeline_version.encode()
    + detector_model_sha.encode()
    + cleaner_model_sha.encode()
    + canonical_json(settings)
).hexdigest()
```

เขียนไฟล์ผ่าน temporary directory แล้ว atomic rename เก็บ `clean.png`, `mask.png`, `result.json`; manual retry สร้าง derived key และไม่เขียนทับ automatic result.

- [ ] **Step 4: Implement bounded pipeline**

ลำดับ exact:

1. detect
2. refine
3. route
4. clean region ตาม route
5. compose
6. verify โดยรัน residual probe เฉพาะ cleaned crop ไม่รัน detector ทั้งหน้า
7. หาก residual สูงให้ขยาย region mask อีก 2 พิกเซลและ retry หนึ่งครั้ง
8. หากยังไม่ผ่านให้คืน original region และตั้ง `needs_review`
9. encode PNG แบบ lossless

Text-free path ต้องคืน `original.copy()`, zero mask และ region ว่างโดยไม่เรียก cleaner.

- [ ] **Step 5: Verify และ commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_compositor.py tests/test_verifier.py tests/test_pipeline.py -v
```

Expected: PASS รวม text-free byte identity และ one-retry bound

Commit:

```powershell
git add ocr-service/app/compositor.py ocr-service/app/residual_probe.py ocr-service/app/verifier.py ocr-service/app/cache.py ocr-service/app/pipeline.py ocr-service/tests/test_compositor.py ocr-service/tests/test_verifier.py ocr-service/tests/test_pipeline.py
git commit -m "feat(cleaning): orchestrate verified repairs"
```

---

### Task 8: FastAPI Async Job Service

**Files:**
- Create: `ocr-service/app/jobs.py`
- Create: `ocr-service/app/api.py`
- Create: `ocr-service/tests/test_api.py`
- Create: `ocr-service/run.ps1`

**Interfaces:**
- Produces endpoints ตาม spec: health, create job, job status, result, assets, region retry
- `JobStore.submit(source_bytes, filename) -> job_id`
- ใช้ executor `max_workers=1` เพื่อไม่ให้หลาย job แย่ง CPU/RAM

- [ ] **Step 1: เขียน failing API contract tests**

```python
def test_create_job_returns_202(client, png_bytes) -> None:
    response = client.post(
        "/v1/jobs",
        files={"image": ("page.png", png_bytes, "image/png")},
    )
    assert response.status_code == 202
    assert response.json()["status"] == "queued"


def test_upload_rejects_unsupported_media_type(client) -> None:
    response = client.post(
        "/v1/jobs",
        files={"image": ("page.txt", b"x", "text/plain")},
    )
    assert response.status_code == 415
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `.\.venv\Scripts\pytest tests/test_api.py -v`

Expected: FAIL เพราะไม่มี FastAPI app

- [ ] **Step 3: Implement API และ job lifecycle**

- รับเฉพาะ PNG/JPEG/WebP และตรวจ magic bytes ด้วย Pillow
- จำกัด 80 MB; เกินคืน `413`
- POST job คืน `202`
- GET status คืน `Cache-Control: no-store`
- result ก่อนสำเร็จคืน `409`
- asset ใช้ `FileResponse` พร้อม `image/png`
- retry รับ multipart `mask` และ field `cleaner=auto|flat|opencv|aot|anime-lama`
- exception ภายใน region ไม่ทำให้ job store หาย และ error response ไม่เปิดเผย filesystem path

- [ ] **Step 4: เพิ่ม integration test พร้อม fake pipeline**

Inject `pipeline_factory` ที่คืนภาพ 8×8 เพื่อยืนยัน lifecycle:

`queued -> running -> succeeded -> result/assets available`

และยืนยัน job สองงานไม่รันพร้อมกันด้วย fake pipeline ที่บันทึก active count สูงสุดเป็น 1.

- [ ] **Step 5: Verify และ commit**

Run:

```powershell
.\.venv\Scripts\pytest tests/test_api.py -v
.\.venv\Scripts\pytest --cov=app --cov-report=term-missing
```

Expected: PASS; coverage ของ service modulesอย่างน้อย 85%

Commit:

```powershell
git add ocr-service/app/jobs.py ocr-service/app/api.py ocr-service/tests/test_api.py ocr-service/run.ps1
git commit -m "feat(cleaning): expose local job API"
```

---

## Phase 2: Next.js Integration and Editor

### Task 9: Frontend Test Harness, Types, Proxy และ Client

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.mts`
- Create: `tests/setup.ts`
- Create: `lib/cleaning/types.ts`
- Create: `lib/cleaning/client.ts`
- Create: `src/app/api/clean/[...path]/route.ts`
- Create: `tests/cleaning/client.test.ts`
- Create: `tests/cleaning/proxy.test.ts`

**Interfaces:**
- Produces: `CleaningJob`, `CleaningResult`, `CleaningRegion`, `CleanerOverride`
- `createCleaningJob(file: Blob) -> Promise<CleaningJob>`
- `getCleaningJob(jobId: string) -> Promise<CleaningJob>`
- `getCleaningResult(jobId: string) -> Promise<CleaningResult>`
- `retryCleaningRegion(jobId, regionId, mask, cleaner) -> Promise<CleaningJob>`

- [ ] **Step 1: ติดตั้ง Vitest ตามคู่มือ Next.js 16**

Run:

```powershell
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths
```

เพิ่ม scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

ตั้ง `vitest.config.mts` เป็น `jsdom`, ใช้ `react()` และ `tsconfigPaths()`.

- [ ] **Step 2: เขียน failing client test**

```typescript
import { beforeEach, expect, test, vi } from "vitest";
import { createCleaningJob } from "@/lib/cleaning/client";

beforeEach(() => vi.restoreAllMocks());

test("createCleaningJob posts multipart to local proxy", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ job_id: "job-1", status: "queued", stage: "queued" }, { status: 202 }),
  );
  const result = await createCleaningJob(new Blob(["png"], { type: "image/png" }));
  expect(result.jobId).toBe("job-1");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/clean/v1/jobs");
  expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
});
```

- [ ] **Step 3: Implement TS contracts/client**

ใช้ camelCase ฝั่งเว็บและมี decoder แปลง snake_case จาก service. ทุก request ส่ง `cache: "no-store"`; non-2xx แปลงเป็น `CleaningClientError(status, message, recovery)`.

- [ ] **Step 4: Implement catch-all Route Handler**

ใช้ Next.js 16 `RouteContext<'/api/clean/[...path]'>`, ต่อ path หลัง fixed base `SUPERK_CLEANER_URL ?? "http://127.0.0.1:8765"`, forward method/body/content-type และคืน upstream stream โดยตั้ง `Cache-Control: no-store`.

ไม่ใช้ `proxy.ts`; `proxyClientMaxBodySize` จึงไม่เกี่ยวกับ upload route นี้. POST อ่าน `request.arrayBuffer()` หนึ่งครั้งและ reject body เกิน 80 MB ด้วย `413`.

- [ ] **Step 5: Verify และ commit**

Run:

```powershell
npm test -- tests/cleaning/client.test.ts tests/cleaning/proxy.test.ts
npm run lint
npx tsc --noEmit
```

Expected: PASS

Commit:

```powershell
git add package.json package-lock.json vitest.config.mts tests/setup.ts lib/cleaning src/app/api/clean
git commit -m "feat(cleaning): add web service client"
```

---

### Task 10: Per-page Cleaning Hook และ Persistence

**Files:**
- Create: `hooks/useCleaning.ts`
- Modify: `lib/projectStore.ts`
- Create: `tests/cleaning/useCleaning.test.tsx`
- Create: `tests/cleaning/projectStore.test.ts`

**Interfaces:**
- Produces `useCleaning({ pages, currentPage })`
- Returns `cleanCurrentPage`, `retryRegion`, `cancelPolling`, `currentResult`, `progress`, `error`, `resultsByPage`
- Map key คือ original page URL เพื่อทำงานกับ `pages` shape เดิม

- [ ] **Step 1: เขียน failing hook test**

```tsx
test("polls until succeeded and stores result for current page", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob)
    .mockResolvedValueOnce(runningJob)
    .mockResolvedValueOnce(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);

  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:page-1"], currentPage: 0 }),
  );
  await act(() => result.current.cleanCurrentPage(sourceBlob));
  await waitFor(() => expect(result.current.currentResult?.jobId).toBe("job-1"));
});
```

- [ ] **Step 2: Implement polling และ object URL lifecycle**

- Poll ทุก 500 ms ขณะ queued/running
- หยุดทันทีเมื่อ succeeded/failed, page เปลี่ยน, component unmount หรือ user cancel
- Fetch clean/mask assets เป็น Blob แล้วสร้าง object URLs
- Revoke URL เก่าเมื่อ retry สำเร็จ, project clear หรือ unmount
- ไม่เริ่ม job ซ้ำเมื่อ source hash/settings เดิมมี cache result

- [ ] **Step 3: เพิ่ม persistence schema version**

เพิ่ม `cleaningResults` ลง IndexedDB เป็น metadata:

```typescript
type StoredCleaningResult = {
  pageUrl: string;
  sourceHash: string;
  jobId: string;
  regions: CleaningRegion[];
  updatedAt: number;
};
```

ไม่ persist blob URL เพราะใช้ข้าม session ไม่ได้ เมื่อ restore ให้เรียก result/assets endpoint ด้วย `jobId`; ถ้า service cache ไม่มีให้แสดงสถานะ “ต้องคลีนใหม่”.

- [ ] **Step 4: ทดสอบ cancel/error/restore**

เพิ่ม tests ยืนยัน:

- page change aborts polling
- service offline คืน recovery `"start-local-service"`
- stale saved job ไม่ทำให้ crash
- clear session ล้าง cleaning metadata

- [ ] **Step 5: Verify และ commit**

Run:

```powershell
npm test -- tests/cleaning/useCleaning.test.tsx tests/cleaning/projectStore.test.ts
npm run lint
npx tsc --noEmit
```

Expected: PASS

Commit:

```powershell
git add hooks/useCleaning.ts lib/projectStore.ts tests/cleaning/useCleaning.test.tsx tests/cleaning/projectStore.test.ts
git commit -m "feat(cleaning): track page cleaning jobs"
```

---

### Task 11: Layer UI, Mask Editing และ Browser Inpaint Removal

**Files:**
- Create: `components/cleaning/CleaningToolbar.tsx`
- Create: `components/cleaning/MaskEditor.tsx`
- Create: `lib/cleaning/maskEdits.ts`
- Modify: `src/app/page.tsx`
- Modify: `lib/translationOverlay.ts`
- Create: `tests/cleaning/maskEdits.test.ts`
- Create: `tests/cleaning/CleaningToolbar.test.tsx`
- Create: `tests/cleaning/translationOverlay.test.ts`

**Interfaces:**
- `applyBrush(mask, points, radius, mode) -> ImageData`
- `MaskEditor` ส่ง `onRetry(maskBlob, cleanerOverride)`
- `applyTranslationOverlay` ทำเฉพาะ text rendering
- `downloadTranslatedImage` วาด `<img>` ที่แสดงอยู่เป็น background แล้ววาด translated text layer

- [ ] **Step 1: เขียน failing pure mask-edit tests**

```typescript
test("eraser clears only pixels inside brush radius", () => {
  const mask = filledMask(20, 20);
  const edited = applyBrush(mask, [{ x: 10, y: 10 }], 3, "erase");
  expect(alphaAt(edited, 10, 10)).toBe(0);
  expect(alphaAt(edited, 0, 0)).toBe(255);
});

test("paint clips brush at image boundary", () => {
  const mask = emptyMask(10, 10);
  expect(() => applyBrush(mask, [{ x: 0, y: 0 }], 8, "paint")).not.toThrow();
});
```

- [ ] **Step 2: Implement layer state และ toolbar**

เพิ่ม state:

```typescript
type CleaningLayer = "original" | "clean" | "mask";
```

Toolbar แสดง:

- ปุ่ม “คลีนข้อความ”
- stage + elapsed time + region progress
- Original/Clean/Mask toggle
- ปุ่มเปิด mask editor
- ข้อความเปิด `ocr-service\run.ps1` เมื่อ health check ล้มเหลว

Active `<img>` ใช้:

```typescript
const imageSrc =
  cleaningLayer === "original"
    ? pages[currentPage].url
    : currentResult?.cleanUrl ?? pages[currentPage].url;
```

Mask layer เป็น `<img>` absolute overlay และมี opacity slider; ห้ามแก้ source image DOM.

- [ ] **Step 3: Implement MaskEditor และ undo**

- Canvas dimensions เท่าพิกเซล source mask
- Pointer coordinates แปลงด้วย `naturalWidth / clientWidth`
- Brush radius แสดงเป็น source pixels
- `paint` และ `erase`
- cleaner override: `auto`, `flat`, `opencv`, `aot`, `anime-lama`
- ก่อน brush stroke เก็บ mask snapshot และ push เข้า `undoManager`
- Retry ส่ง PNG Blob และ region ID

- [ ] **Step 4: ลบ browser inpainting ออกจาก overlay**

ลบโค้ดต่อไปนี้จาก `lib/translationOverlay.ts`:

- brightness threshold mask
- `cv.worker.js` invocation
- `inpainted-bg` canvas
- solid-bubble fallback ที่ใช้แก้ภาพต้นฉบับ

คงเฉพาะการคำนวณตำแหน่ง การตัดบรรทัด การลาก/แก้ข้อความ และ export text canvas. Offscreen export ต้องตั้ง `offscreen-image.src` เป็น clean URL เมื่อมีผลคลีน.

- [ ] **Step 5: Verify UI/export และ commit**

Run:

```powershell
npm test -- tests/cleaning/maskEdits.test.ts tests/cleaning/CleaningToolbar.test.tsx tests/cleaning/translationOverlay.test.ts
npm run lint
npx tsc --noEmit
npm run build
```

Expected:

- tests PASS
- build exit 0
- ไม่มี `new Worker('/cv.worker.js')`, brightness mask หรือ `#inpainted-bg` ใน `translationOverlay.ts`

Commit:

```powershell
git add components/cleaning lib/cleaning/maskEdits.ts hooks/useCleaning.ts src/app/page.tsx lib/translationOverlay.ts tests/cleaning
git commit -m "feat(cleaning): add layered mask editor"
```

---

### Task 12: Benchmark Corpus, Regression และ Acceptance Gate

**Files:**
- Create: `ocr-service/benchmarks/manifest.schema.json`
- Create: `ocr-service/benchmarks/manifest.json`
- Create: `ocr-service/scripts/build_benchmark_manifest.py`
- Create: `ocr-service/scripts/benchmark.py`
- Create: `ocr-service/tests/test_benchmark_manifest.py`
- Create: `docs/cleaning-benchmark.md`
- Modify: `README.md`

**Interfaces:**
- Manifest entries: `relative_path_hash`, `sha256`, `width`, `height`, `categories`
- ห้ามเก็บชื่อเต็มหรือภาพจาก `F:\Doujin\Download` ใน Git
- Benchmark output: JSON + Markdown summary ใต้ ignored `ocr-service/benchmark-results/`

- [ ] **Step 1: เขียน failing manifest privacy tests**

```python
def test_manifest_has_30_unique_source_pages(manifest) -> None:
    assert len(manifest["pages"]) == 30
    assert len({p["sha256"] for p in manifest["pages"]}) == 30


def test_manifest_does_not_store_external_absolute_paths(manifest_text: str) -> None:
    assert "F:\\" not in manifest_text
    assert "E:\\" not in manifest_text
    assert "[English]" not in manifest_text
    assert "[Chinese]" not in manifest_text
    assert "[Thai]" not in manifest_text
```

- [ ] **Step 2: Implement deterministic selection**

`build_benchmark_manifest.py`:

- รับ `--root "F:\Doujin\Download"`
- ตัด folder tag `[English]`, `[Chinese]`, `[Thai]`, `ภาษาไทย`, `[中国翻訳]`
- อ่านเฉพาะ PNG/JPEG/WebP
- ใช้ fixed seed `20260727`
- เลือก 30 unique hashes ครอบ category: white bubble, colored bubble, vertical Japanese, outlined/colored text, artwork SFX, screentone, complex color, dense text, text-free
- เก็บเพียง SHA-256 ของ relative path ไม่เก็บชื่อจริง

Regression set จาก `E:\SuperK` ไม่เขียนลง manifest หลัก ให้ `benchmark.py` รับ `--regression-page` ซ้ำได้และรันสองไฟล์:

```powershell
--regression-page "E:\SuperK\SuperK_Page_001_1.webp" `
--regression-page "E:\SuperK\SuperK_Page_001_2.webp"
```

Regression check ต้องรายงาน rectangular-patch score จาก connected changed area; fail เมื่อมี changed component รูปสี่เหลี่ยมที่ fill ratio `>=0.85` และกินพื้นที่มากกว่า `1%` ของหน้า

- [ ] **Step 3: Implement quality/performance runner**

Report ต่อหน้า:

- detect/refine/clean/verify/encode/total ms
- region count แยกตาม route
- residual pass rate
- needs-review rate
- changed pixels outside support
- peak RSS

Warmup 1 หน้า แล้ววัดครบ 30 หน้า; คำนวณ median และ p95. รัน AOT ทุกหน้า artwork และ AnimeLaMa เฉพาะเมื่อ optional dependency/model พร้อม.

- [ ] **Step 4: รัน acceptance และบันทึกผล**

Run:

```powershell
cd ocr-service
.\.venv\Scripts\python scripts/build_benchmark_manifest.py --root "F:\Doujin\Download" --count 30
.\.venv\Scripts\pytest tests/test_benchmark_manifest.py -v
.\.venv\Scripts\python scripts/benchmark.py --root "F:\Doujin\Download" --manifest benchmarks/manifest.json --cleaner aot --regression-page "E:\SuperK\SuperK_Page_001_1.webp" --regression-page "E:\SuperK\SuperK_Page_001_2.webp"
```

Pass gate:

- median total `<=30000 ms`
- residual pass `>=95%`
- automatic region pass `>=90%`
- changed pixels outside support `=0`
- text-free pages pixel-identical

หาก AnimeLaMa ให้ residual/damage ดีกว่า AOT อย่างน้อย 5 percentage points และ median ยังไม่เกิน 30 วินาที จึงเปลี่ยน default; มิฉะนั้นคง AOT เป็น default.

- [ ] **Step 5: Full verification และ commit**

Run:

```powershell
cd C:\Users\PC\Downloads\manga-translator
.\ocr-service\.venv\Scripts\pytest ocr-service/tests -v
npm test
npm run lint
npx tsc --noEmit
npm run build
rg -n "cv\\.worker|inpainted-bg|brightness >|brightness <" lib/translationOverlay.ts
git diff --check
```

Expected:

- Python/TypeScript tests PASS
- lint/typecheck/build PASS
- `rg` ไม่พบ browser inpainting pattern
- `git diff --check` ไม่มี output

เพิ่ม `README.md` ด้วยคำสั่งติดตั้ง model, เปิด service และเปิด Next.js โดยไม่กล่าวอ้าง GPU.

Commit:

```powershell
git add ocr-service/benchmarks ocr-service/scripts/build_benchmark_manifest.py ocr-service/scripts/benchmark.py ocr-service/tests/test_benchmark_manifest.py docs/cleaning-benchmark.md README.md
git commit -m "test(cleaning): add quality benchmark"
```

---

## Execution Checkpoints

1. หลัง Task 3: เปิด `detector_page.png` พร้อม mask overlay และยืนยันว่า mask ตามตัวอักษร ไม่ใช่เต็มกรอบ
2. หลัง Task 6: เปรียบเทียบ AOT กับ AnimeLaMa บน artwork crop อย่างน้อย 6 แบบก่อนเลือก default
3. หลัง Task 8: ทดสอบ local API ด้วยภาพเดียวก่อนเชื่อมหน้าเว็บ
4. หลัง Task 11: ตรวจ Original/Clean/Mask, manual retry และ export ใน browser
5. หลัง Task 12: ตัดสินผ่าน acceptance จากตัวเลข benchmark ไม่ใช้ความรู้สึก

## Out-of-scope Follow-up

หลังแผนนี้ผ่าน acceptance แล้วจึงเขียน spec/plan แยกสำหรับ Chrome Extension โดย reuse local service contract ห้ามนำ white rectangle mask ใน extension มาใช้เป็น fallback ของระบบใหม่
