# Unused Files Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. ใช้ subagents เฉพาะเมื่อผู้ใช้หรือคำสั่งที่ใช้บังคับอนุญาต

**Goal:** ลดโค้ดที่ไม่มีผู้เรียกในระบบจริง โดยรักษาพฤติกรรมการแปล การแก้ไขภาพ การบันทึกงาน และชุด editor ที่ผู้ใช้เลือกเก็บไว้

**Architecture:** ลบเฉพาะโมดูลที่ไม่ได้เชื่อมกับ runtime พร้อม tests ที่ทดสอบโมดูลนั้นโดยตรง ปรับ tests ที่ปะปนกับระบบจริงให้รักษา assertions ของระบบจริงไว้ ไม่ต่อฟีเจอร์ใหม่และไม่เปลี่ยน routing ของ Gemini

**Tech Stack:** Next.js, TypeScript, Vitest, Python, FastAPI, pytest, Electron

**สถานะ:** แผนเสนอสำหรับรอบถัดไป ยังไม่ได้ดำเนินการลบไฟล์

**ฐานการตรวจ:** commit `54fe1d9`; ตรวจ static imports จาก JS/TS แอป 98 ไฟล์ พบ 15 ไฟล์ที่ไม่เชื่อมถึง entrypoints รวมเครื่องมือ benchmark 2 ไฟล์ ตรวจ Python เพิ่มด้วยการค้นผู้เรียก ไม่ใช่ runtime coverage และไม่ใช่หลักฐานว่าไฟล์ทั้งหมดลบทิ้งได้

## Global Constraints

- เก็บชุด editor และ tests ตามข้อสรุปใน `docs/cleanup-design-review.md`
- ไม่ลบ dependencies ในรอบนี้ เพราะชุด editor ที่เก็บไว้ยังอาจต้องใช้
- ไม่แก้ production Gemini routing: คง `requestGemini()` ตาม `docs/AI-WORKING-NOTES.md`
- ไม่ลบ experimental catalog/router ทั้งไฟล์ เพราะมีส่วนที่ยังถูกใช้
- ไม่แตะรูปต้นฉบับ งานผู้ใช้ models, job caches, public assets, `.scratch`, `scratch`, `EP1_AutoRender` หรือ `tools`
- ไม่ถือว่าไม่มี import เท่ากับไม่ใช้: ตรวจ framework conventions, scripts, dynamic imports และ references ก่อนทุกงาน
- หากพบผู้เรียก production ใหม่ ให้หยุดการลบเฉพาะรายการนั้นและบันทึกเหตุผล ไม่ย้ายผู้เรียกไปใช้ implementation ใหม่โดยพลการ
- การลดโค้ดที่ไม่ถูกโหลดไม่ได้ยืนยันว่าจะทำให้แอปเร็วขึ้นหรือใช้ RAM ลดลง
- งานนี้ไม่เพิ่ม rate limiting และไม่อ้างว่าระบบมี rate limiting จากไฟล์ที่ไม่เคยถูกเรียก
- ไม่เพิ่ม tests เพื่อยืนยันเพียงว่าไฟล์ถูกลบ ใช้ regression tests ของพฤติกรรมที่ยังมีอยู่
- ก่อนแก้โค้ด Next.js ให้อ่าน guide ที่เกี่ยวข้องจาก `node_modules/next/dist/docs/` ตาม AGENTS.md
- stage เฉพาะไฟล์ของแต่ละงาน ไม่ใช้ `git add .`; ไม่ push จนผู้ใช้สั่ง

## แผนที่ไฟล์และข้อเสนอ

### เสนอให้ลบในรอบนี้: production candidates 4 ไฟล์

| ไฟล์ | เหตุผล | งานที่เกี่ยวข้อง |
|---|---|---|
| `components/workspace/MobileToolsMenu.tsx` | ไม่พบผู้เรียก รวมทั้ง tests | Task 1 |
| `lib/lifecycle/sessionSpillCache.ts` | เลิกใช้ใน WorkspaceResourceManager หลังแก้การเก็บ render เกิน budget; เหลือ tests โดยตรง | Task 2 |
| `lib/server/rateLimiter.ts` | ไม่ถูกใช้ใน API; เหลือ unit tests และ reset ใน route tests | Task 3 |
| `ocr-service/app/cache.py` | ResultCache ใช้เฉพาะ tests; ไม่ใช่ job storage ที่ระบบใช้งาน | Task 4 |

### เก็บไว้: editor/UI ที่ยังไม่ต่อกับหน้าหลัก 10 ไฟล์

- `components/colorMatching/ColorMatchStatus.tsx`
- `components/editing/ImageLayerPanel.tsx`
- `components/editing/OcrAreaTool.tsx`
- `components/editing/StudioToolbar.tsx`
- `components/editing/TextLayerCanvas.tsx`
- `components/editing/TextPropertiesPanel.tsx`
- `components/editing/WarpPanel.tsx`
- `components/workspace/WorkspaceExportButtons.tsx`
- `hooks/useTextLayers.ts`
- `lib/editing/commands.ts`

`useTextLayers.ts` ไม่พบผู้เรียก แต่เก็บเป็นส่วนของชุด editor ตามการตัดสินใจก่อนหน้า รวมทั้ง dependencies และ tests ของชุดนี้

### เก็บไว้เพราะมีหน้าที่นอก runtime

- `lib/lifecycle/benchmark.ts` และ `lib/lifecycle/types.ts`: ใช้ใน benchmark tests
- `ocr-service/app/cleaners/anime_lama.py`: ใช้ใน `ocr-service/scripts/benchmark.py` และ tests
- `lib/server/geminiTranslationRouter.ts`: `executeGeminiTranslation()` ยังไม่ใช้แปลจริง แต่ไฟล์มี helper ที่ถูกใช้ จึงไม่ลบทั้งไฟล์
- `.agents`, `docs`, `tests`, build scripts และ config: ไม่ใช้เกณฑ์ production imports ตัดสินว่าร้าง
- ภาพใน `public` อาจเปิดผ่าน URL โดยตรง; ไฟล์ทดลองและเครื่องมือในเครื่องต้องทบทวนแยกต่างหาก

## Task 0: บันทึกฐานและตรวจ references ใหม่

**Files:** อ่าน `docs/cleanup-design-review.md`, `docs/AI-WORKING-NOTES.md`, `docs/ram-render-cache-fix.md` และไฟล์ในตารางด้านบน

**Interfaces:** ใช้ entrypoints และ tests เดิม; ไม่สร้าง public API ใหม่

- [x] รันจาก root ของ repository และบันทึก HEAD/status ก่อนเริ่ม:

```powershell
git status --short
git rev-parse HEAD
```

- [x] ค้น references ของทุก export รวมถึง aliases ไม่ใช่เฉพาะชื่อไฟล์:

```powershell
rg -n 'MobileToolsMenu|sessionSpillCache|SessionProcessedPageSpillCache|SpillCacheEntry|rateLimiter|checkRateLimit|resetRateLimits|getClientIp|maskApiKey|validatePayloadSize|RateLimitResult|ResultCache|CachedResult|app\.cache' src components hooks lib tests scripts electron chrome-extension ocr-service/app ocr-service/tests ocr-service/scripts
```

คาดว่าจะพบแต่ declarations, tests และ reset ใน route tests สำหรับ 4 candidates หากพบ production caller ให้พักรายการนั้น

- [x] รัน baseline จาก root:

```powershell
node node_modules/vitest/vitest.mjs run --root .
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

- [x] รัน baseline Python จาก `ocr-service`:

```powershell
.\venv\Scripts\python.exe -m pytest tests -q -m "not model" -p no:cacheprovider
```

หลักฐานก่อนเขียนแผน: Vitest 846 tests ผ่าน, TypeScript ผ่าน, Python 177 ผ่าน/3 deselected ตัวเลขนี้เป็นข้อมูลย้อนหลัง ต้องบันทึกผลใหม่เมื่อเริ่มทำ

## Task 1: ถอด MobileToolsMenu ที่ไม่มีผู้เรียก

**Files:** Delete `components/workspace/MobileToolsMenu.tsx`

**Interfaces:** ไม่มีผู้เรียกที่ตรวจพบ; ไม่กระทบ API ของ Workspace

- [x] ตรวจ references ซ้ำตาม Task 0 และตรวจว่าไม่มีการโหลดจากชื่อไฟล์แบบประกอบ string
- [x] ลบเฉพาะ `components/workspace/MobileToolsMenu.tsx` ด้วย patch ไม่ลบทั้งโฟลเดอร์
- [x] รัน `node node_modules/vitest/vitest.mjs run --root . tests/workspace` และ TypeScript ตาม Task 0; ต้องผ่าน
- [x] ตรวจ diff ว่าไม่มี UI อื่นหรือ dependency ถูกลบ แล้ว commit:

```powershell
git add -- components/workspace/MobileToolsMenu.tsx
git commit -m "chore(workspace): remove unused mobile tools menu"
```

## Task 2: ถอด standalone spill cache ที่เลิกใช้แล้ว

**Files:**
- Delete `lib/lifecycle/sessionSpillCache.ts`
- Delete `tests/lifecycle/sessionSpillCache.test.ts`
- Modify `docs/ram-render-cache-fix.md`
- Preserve `lib/lifecycle/workspaceResourceManager.ts` และ `tests/lifecycle/renderEviction.test.ts`

**Interfaces:** การ evict ยังคืน cache miss เพื่อให้ผู้เรียก render ใหม่; ไม่เพิ่ม storage หรือ restore path ใหม่

- [x] ยืนยันว่าไม่มีผู้เรียกนอก dedicated test
- [x] ลบ utility และ dedicated test ข้างต้นด้วย patch
- [x] แก้ย่อหน้าที่บอกว่าเก็บ standalone utility ไว้ใน `docs/ram-render-cache-fix.md` เป็น:

```text
The unused standalone sessionSpillCache utility and its dedicated tests were
removed in the follow-up cleanup. WorkspaceResourceManager still returns a
cache miss after eviction, and callers regenerate the render from saved bubbles.
```

- [x] รัน regression tests:

```powershell
node node_modules/vitest/vitest.mjs run --root . tests/lifecycle tests/workflow/systemHealthAcceptance.test.tsx
```

ต้องผ่าน โดยยังครอบคลุม oversized render, การ evict หลายหน้า และ render ใหม่หลัง cache miss ไม่แก้ assertions ให้กลับไปยอมรับ spill ใน RAM

- [x] stage เฉพาะ 3 ไฟล์ข้างต้น แล้ว commit `chore(resources): remove unused session spill cache`

## Task 3: ถอด rateLimiter ที่ไม่เคยต่อเข้ากับ API

**Files:**
- Delete `lib/server/rateLimiter.ts`
- Delete `tests/server/rateLimiter.test.ts`
- Modify `tests/translation/routes.test.ts`

**Interfaces:** คง handlers และ error behavior ของ API เดิม; ไม่เพิ่มหรือถอดการจำกัดคำขอที่ทำงานอยู่

- [x] ตรวจทุก export ตาม Task 0 หาก utility ใดมี production caller ใหม่ ห้ามลบทั้งไฟล์
- [x] ลบ import ต่อไปนี้จาก `tests/translation/routes.test.ts`:

```typescript
import { resetRateLimits } from "@/lib/server/rateLimiter";
```

- [x] ลบเฉพาะ `resetRateLimits();` จาก setup ให้เหลือ:

```typescript
beforeEach(() => {
  vi.restoreAllMocks();
  requestGeminiMock.mockReset();
});
```

- [x] ลบ helper และ dedicated unit test; รักษา route tests ทุก case
- [x] รัน `node node_modules/vitest/vitest.mjs run --root . tests/translation tests/extension` และ TypeScript ตาม Task 0; ต้องผ่าน
- [x] stage เฉพาะ 3 ไฟล์ข้างต้น แล้ว commit `chore(server): remove disconnected rate limit helpers`

## Task 4: ถอด ResultCache โดยเก็บการทดสอบ API จริง

**Files:**
- Delete `ocr-service/app/cache.py`
- Modify `ocr-service/tests/test_pipeline.py`
- Modify `ocr-service/tests/test_api.py`

**Interfaces:** คง job results และ pipeline version ใน API; ไม่แตะ `jobs.py`, job directories หรือ cache ที่ active pipeline ใช้

- [x] ยืนยัน `ResultCache`, `CachedResult` และ `app.cache` ไม่มีผู้เรียก production
- [x] ใน `test_pipeline.py` ลบ import `from app.cache import ResultCache` และลบเฉพาะ function `test_result_cache_round_trips_lossless_assets`; รักษา pipeline tests ที่เหลือ
- [x] ใน `test_api.py` แทนที่ function `test_api_pipeline_version_invalidates_cache_and_reports_glyph_version` ทั้ง function ด้วย:

```python
def test_api_reports_pipeline_version(
    client: TestClient,
    png_bytes: bytes,
) -> None:
    created = client.post(
        "/v1/jobs",
        files={"image": ("page.png", png_bytes, "image/png")},
    ).json()
    job = _wait_for_terminal(client, created["job_id"])
    assert job["status"] == "succeeded"

    result = client.get(f"/v1/jobs/{created['job_id']}/result").json()
    assert result["pipeline_version"] == "2.3.1-enclosed-backing"
```

คงค่า version ที่ contract ทดสอบอยู่ ไม่เปลี่ยน production version เพื่อให้ test ผ่าน หาก baseline เปลี่ยนก่อนเริ่มงาน ให้รักษา contract ณ baseline นั้น

- [x] ลบ `ocr-service/app/cache.py` ด้วย patch
- [x] จาก `ocr-service` รัน:

```powershell
.\venv\Scripts\python.exe -m pytest tests/test_api.py tests/test_pipeline.py -q -m "not model" -p no:cacheprovider
```

ต้องผ่าน รวม tests ของ result endpoint และ purge endpoint; การลดจำนวน tests ต้องมาจาก dedicated cache test ที่ลบเท่านั้น

- [x] stage เฉพาะ 3 ไฟล์ข้างต้น แล้ว commit `chore(ocr): remove unused result cache abstraction`

## Task 5: ตรวจรวมและบันทึกผล

**Files:** Modify `docs/unused-code-cleanup.md` และ checklist ในแผนนี้

**Interfaces:** ไม่มีการเปลี่ยน runtime เพิ่มเติม

- [x] รัน reference search ตาม Task 0 อีกครั้ง คาดว่าไม่มี references ที่ยังใช้งานไปหาไฟล์ที่ลบ; การกล่าวถึงในเอกสารประวัติไม่ใช่ broken import
- [x] รัน Vitest ทั้งชุด, TypeScript และ Python non-model suite ตาม Task 0 ใหม่ ต้องผ่านทั้งหมด
- [x] รัน production build จาก root:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build
```

ต้อง exit 0; หาก build ถูกบล็อกด้วย environment/network ให้บันทึกข้อจำกัดจริง ไม่อ้างว่าผ่าน ไม่ต้องติดตั้ง dependencies ใหม่เพราะแผนนี้ไม่แก้ manifest/lockfile

- [x] ตรวจ `git diff --check` และ diff ของทุก commit เทียบ baseline ว่าไม่มีไฟล์นอกขอบเขต ไม่มีการลบ editor, assets หรือข้อมูลผู้ใช้
- [x] เพิ่มส่วน Follow-up unused files cleanup ใน `docs/unused-code-cleanup.md` ระบุ 4 candidates ที่ลบจริง, tests ที่ถอด, API assertion ที่รักษา, ผลคำสั่งและไฟล์ที่ยังเก็บไว้ ห้ามนำผลก่อน cleanup มาอ้างเป็นผลหลัง cleanup
- [x] ทำเครื่องหมายเฉพาะขั้นตอนที่เสร็จจริง; commit เอกสาร `docs: record follow-up unused file cleanup`

## เกณฑ์ปิดงานและ rollback

- ไม่มี broken imports, TypeScript errors หรือ regression failures จากการลบ
- การลดจำนวน tests อธิบายได้จาก dedicated tests ที่ลบ ไม่ใช่การปิดข้าม tests ที่ล้ม
- ไม่มีการเปลี่ยน routing, security policy, editor behavior หรือ job persistence
- แยก commit ตาม Task 1–4 เพื่อย้อนคืนเป็นรายชุด หากเกิด regression ให้ใช้ `git revert <hash ของงานนั้น>` โดยตรวจ local changes ก่อน ไม่ใช้ hard reset
- รายงาน hash, จำนวน tests และข้อจำกัดของ build ตามผลจริง; รายการที่พบผู้เรียกใหม่ต้องระบุว่าเก็บไว้พร้อมเหตุผล
- การเขียนแผนนี้ไม่ใช่การดำเนิน cleanup หรืออนุมัติ push เพิ่มเติม
