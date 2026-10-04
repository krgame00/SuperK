# Doujin Library Phase 2 Deep Refining & Artist Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely audit, classify, and organize the remaining 274 items (~33.82 GB) in `F:\Doujin\07_Original_Other\`: extract latent game/anime franchises (e.g. Honkai: Star Rail Kafka/Remora, Pokemon Yanje), cluster prolific original artists (e.g. Omochi no Mochiya, Ichigo Crown, Souichi_19, Retoposy, Pixiv Creators), isolate audio/ASMR/video, and purge empty collision artifacts with 100% byte-for-byte verification.

**Architecture:**
- Pre-flight deep forensic scan script peeking archive contents, Japanese/Chinese kanji franchise keywords (崩壊-スターレイル, 卡夫卡, 原神, etc.), artist signatures, and file extensions.
- Structured classification map routing items to:
  1. `01_Games\` (Honkai Star Rail, Genshin, Pokemon)
  2. `04_3D_Creators\` & `Pixiv_Fanbox_Artists` (Blackwhiplash, Terasu_MC, Retoposy, 3D animators)
  3. `05_Thai_Translated\` (Thai ASMR, Thai School Diary)
  4. `09_Animations_Video\` (PuKu animation, video clips)
  5. `07_Original_Other\Creators\` (Grouped subfolders for original circles with >= 2 works)
- Safe migration engine with byte-for-byte size validation and atomic logging.
- Clean-up of 0-byte empty collision directory stubs (`*_from_e_do`).

**Tech Stack:** Node.js (filesystem, path, crypto), Windows PowerShell, strict byte-for-byte verification.

## Global Constraints
- Target Library: `F:\Doujin\`
- Absolute Protection: Never touch `E:\SuperK`, `F:\Phone_Backup`, `E:\Phone_Backup`, or developer workspaces (`manga-translator`, `PCSpec`, `ZCodeProject`, etc.).
- Safe-move rule: No source file/directory may be removed until the destination exists and matches size/checksum.
- Verification ledger: Log every item moved in `docs/AI-WORKING-NOTES.md` and `.scratch/phase2_refining_ledger.json`.

---

## Tasks

### Task 1: Comprehensive Forensic Scan of `07_Original_Other`
**Files:**
- Create: `.scratch/audit_phase2_07_original.js`
- Output: `.scratch/audit_phase2_07_original.json`

- [x] **Step 1: Write forensic audit script**
  Scan all 274 items in `F:\Doujin\07_Original_Other\`, inspect filename patterns, known franchise names (Honkai, Genshin, Kafka, Pokemon, etc.), artist tags, and media types (ASMR, MP3, MP4, XML).
- [x] **Step 2: Execute audit script**
  Run `node .scratch/audit_phase2_07_original.js` and verify output categories.
- [x] **Step 3: Review proposed migration breakdown**
  Verify the list of franchise extractions, artist groupings, and media re-routes before executing moves.

### Task 2: Re-Route Latent Franchises & Media
**Files:**
- Create: `.scratch/execute_phase2_franchise_migration.js`

- [x] **Step 1: Implement franchise and media migration logic**
  - Honkai Star Rail: Kafka (`[色孽神選] 卡夫卡人格排泄`), Remora (`[remora] イチャイチャ (崩壊-スターレイル)`) -> `01_Games\Honkai_Star_Rail\`
  - Pokemon: Yanje items -> `01_Games\Pokemon\`
  - Animations: PuKu Animated -> `09_Animations_Video\`
  - Thai Audio / ASMR: `ASMR พิเศษเดือนธันวาคม 2025*`, `ไฟล์เสียงวันเกิด 2025*`, `022980 - [aaaaaaaa] THAI SCHOOL DIARY #2.zip` -> `05_Thai_Translated\`
  - 3D Artists: `Blackwhiplash`, `テラスMC` / `Terasu_MC` -> `04_3D_Creators\`
- [x] **Step 2: Execute migration with byte-for-byte size validation**
  Run migration script; ensure 0 failures and 0 byte loss.
- [x] **Step 3: Verify destination paths**
  Confirm files arrived safely and match exact file sizes.

### Task 3: Cluster Prolific Original Artists in `07_Original_Other`
**Files:**
- Create: `.scratch/cluster_original_artists.js`

- [x] **Step 1: Implement creator clustering within `07_Original_Other\`**
  Group circles/artists with >= 2 items into subfolders under `F:\Doujin\07_Original_Other\`:
  - `Omochi_no_Mochiya\` (Numamochi)
  - `Ichigo_Crown\` (Yuzuri Ai)
  - `Souichi_19\` (和田宗一)
  - `Retoposy\`
  - `Dr_Bug\`
  - `Pixiv_Collections\` (Loose Pixiv artist packs)
- [x] **Step 2: Execute clustering with atomic move validation**
  Move matched archives into their respective artist subfolders.
- [x] **Step 3: Verify directory cleanliness**
  Confirm artist folders are populated and root of `07_Original_Other` is organized.

### Task 4: Clean Empty Collision Stubs & Non-Manga Leftovers
**Files:**
- Create: `.scratch/clean_empty_stubs.js`

- [x] **Step 1: Inspect 0-byte directories and empty `*_from_e_do` stubs**
  Find any empty directories in `07_Original_Other\` and other Doujin subfolders.
- [x] **Step 2: Safely remove only confirmed empty folders (0 files, 0 bytes)**
  Never delete non-empty folders; log every removed path.
- [x] **Step 3: Check XML / preset files**
  Inspect `alight_motion_xml_*.zip` to confirm if it should be isolated or preserved.

### Task 5: Master Verification & Ledger Documentation
**Files:**
- Modify: `docs/AI-WORKING-NOTES.md`

- [x] **Step 1: Run comprehensive library catalog indexing**
  Count items, subfolders, and disk space across all 11 categories in `F:\Doujin\`.
- [x] **Step 2: Record verification evidence in `docs/AI-WORKING-NOTES.md`**
  Record status as `VERIFIED WORKING` with exact item counts and disk numbers.
