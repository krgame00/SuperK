# Master Doujin Consolidation & Cross-Drive Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely migrate, deduplicate, and categorize ~2,500+ manga and doujinshi files (~88 GB) from `E:\โด`, `E:\Phone_Backup` (01-04), `F:\Downloads_Archive\Comics_Manga`, and `F:\SuperKC` into a unified, high-speed master library at `F:\Doujin\`, while 100% protecting all user backups, developer workspaces, and project assets.

**Architecture:**
- Pre-flight dry-run inspection to map every file to its target category and identify name/content collisions before touching any files.
- Automated migration runner script (`.scratch/consolidate_master_doujin.js` or Python runner) that enforces byte-for-byte size checks before unlinking any source file.
- Automatic collision resolver: identical content is deduplicated and logged; different content with identical names is preserved using disambiguation suffixes (`_dup_source`).
- Target directory architecture organized by gaming universes (Hoyoverse, Blue Archive), anime/manga, VTubers, 3D artists, Thai translated works, and PDF archive.

**Tech Stack:** Node.js / Python 3.11, Windows filesystem APIs, strict byte-for-byte verification.

## Global Constraints
- Target Destination: `F:\Doujin\`
- Absolute Protection: Never touch `E:\SuperK`, `F:\Phone_Backup`, `E:\Phone_Backup\05*`, `E:\Phone_Backup\06*`, `E:\Phone_Backup\07*`, `E:\Phone_Backup\08*`, or any git workspaces (`manga-translator`, `PCSpec`, `ZCodeProject`, `lnwjud`, etc.).
- Safe-delete rule: No source file may be deleted until the destination file exists and matches the source size exactly (`destStat.size === srcStat.size`).
- Atomic recovery ledger: Log every file moved, deduplicated, or flagged in `docs/AI-WORKING-NOTES.md` and `.scratch/consolidation_ledger.json`.

---

## Target Taxonomy (`F:\Doujin\`)

```
F:\Doujin\
├── 01_Games\
│   ├── Honkai_Star_Rail\          # Firefly, Topaz, Robin, Herta, Silver Wolf, Kafka, etc.
│   ├── Genshin_Impact\            # Raiden, Furina, Hu Tao, Ganyu, Shenhe, Miko, etc.
│   ├── Zenless_Zone_Zero\         # Jane Doe, Bernice, Nicole, Anby, Ye Shunguang, etc.
│   ├── Blue_Archive\              # Nonomi, Kisaki, Toki, Seia, etc.
│   └── Other_Games\               # Fate, KanColle, Idolmaster, Project KV, Slime, LoL
├── 02_Anime_Manga\                # KonoSuba, Frieren, HxH, Black Clover, JJK, DanMachi, etc.
├── 03_VTuber\                     # Hololive (Suisei, Aqua, Pekora) & Nijisanji (Inui Toko, Furen, etc.)
├── 04_3D_Creators\                # Dawalixi, Sollyz_Sundyz, JimPu6, MANA, ProudBanana, Nyantcha
├── 05_Thai_Translated\            # มังงะ/โดจินแปลไทย (PDF, Zip, โฟลเดอร์แปลไทย)
├── 06_PDF_Archive\                # คลัง PDF มังงะคลาสสิก 1,000+ เล่มจาก Phone_Backup
├── 07_Original_Other\             # งานออริจินัลและเรื่องอื่นๆ ที่ไม่ได้สังกัดแฟรนไชส์
└── 08_Game_Patches\               # ม็อด/แพตช์แปลไทยของเกม เช่น BepInEx Patch
```

---

## Tasks

### Task 1: Comprehensive Dry-Run Analysis & Collision Pre-Flight
**Files:**
- Create: `.scratch/preflight_consolidation_audit.py`
- Output: `.scratch/preflight_consolidation_audit.json`

- [x] **Step 1:** Write the Python pre-flight audit script to enumerate all source files.
- [x] **Step 2:** Categorize each item into target subfolder according to tags/name matching.
- [x] **Step 3:** Detect all duplicate filenames and classify them into exact matches and collisions.
- [x] **Step 4:** Execute the audit and review summary statistics with the user before proceeding.

### Task 2: Build the Resilient Safe-Migration Engine
**Files:**
- Create: `.scratch/execute_master_consolidation.py`

- [x] **Step 1:** Implement category directory creation under `F:\Doujin\`.
- [x] **Step 2:** Implement cross-drive copy with chunked streaming and byte-for-byte size verification.
- [x] **Step 3:** Implement deduplication logic (if destination file already exists and size matches, verify hash/size and remove redundant source).
- [x] **Step 4:** Implement collision resolution logic (if destination file exists but size differs, copy as `<name>_from_<source>.<ext>`).
- [x] **Step 5:** Implement real-time progress logging and crash-recovery ledger.

### Task 3: Execute Phase 1 — Consolidate Small Drives & Direct Folders
- Source: `F:\Downloads_Archive\Comics_Manga\`, `F:\SuperKC\`, and root items in `F:\Doujin\`
- [x] **Step 1:** Run Phase 1 migration. (74 items processed, 74 succeeded, 0 failed in 0.1s).
- [x] **Step 2:** Verify all moved items in `F:\Doujin\` subfolders.
- [x] **Step 3:** Verify source folders are clean and safe (`F:\Downloads_Archive\Comics_Manga` and `F:\SuperKC` cleaned).

### Task 4: Execute Phase 2 — Migrate `E:\โด` (33.5 GB) to `F:\Doujin\`
- Source: `E:\โด\`
- [x] **Step 1:** Run Phase 2 migration item by item with size verification. (274 items total: 271 succeeded, 3 deduplicated, 0 failed).
- [x] **Step 2:** Verify recovered space on drive E: (~30.7 GB freed from E:).
- [x] **Step 3:** Verify all items accurately routed to Hoyoverse, 3D Artists, Anime, and Thai folders.

### Task 5: Execute Phase 3 — Migrate `E:\Phone_Backup` Manga Folders (01–04)
- Source:
  - `E:\Phone_Backup\01_มังงะ_แปลไทย\` -> `F:\Doujin\05_Thai_Translated\`
  - `E:\Phone_Backup\02_มังงะ_Doujin_Nh\` -> Respective game/creator folders
  - `E:\Phone_Backup\03_PDF_หนังสือและมังงะ\` -> `F:\Doujin\06_PDF_Archive\`
  - `E:\Phone_Backup\04_คลังบีบอัด_ZIP_MEGA\` -> VTuber / Hoyoverse folders
- [x] **Step 1:** Run Phase 3 migration. (2,055 items total: 2,037 succeeded, 18 deduplicated, 0 failed in 1,551s).
- [x] **Step 2:** Verify `05_วิดีโอและอนิเมชัน`, `06_รูปภาพและแฟนอาร์ต`, `07_แอป...`, `08_งานเก่า...` in `E:\Phone_Backup` remain completely untouched.
- [x] **Step 3:** Verify recovered space on drive E: (Drive E: free space reached 113.59 GB, up from 24.58 GB -> +89.01 GB freed).

### Task 6: Final Verification, Registry Index, and Documentation
**Files:**
- Modify: `docs/AI-WORKING-NOTES.md`

- [x] **Step 1:** Run full catalog indexing on `F:\Doujin\` (2,417 items cataloged and categorized).
- [x] **Step 2:** Verify disk health and free space on all drives (Drive E: 113.59 GB Free, Drive F: 55.63 GB Free).
- [x] **Step 3:** Document the full migration breakdown in `docs/AI-WORKING-NOTES.md`.
