# Master Doujin Library Deep Restructuring & Full Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perform an exhaustive, library-wide categorization across all 2,400+ items in `F:\Doujin\`: sweep 134 stray `.torrent` files into `_Torrents\`, purge 31 empty stubs, organize loose files in `02_Anime_Manga` into 12 dedicated franchise folders (Frieren, KonoSuba, Black Clover, Dr. Stone, etc.), consolidate loose files in `04_3D_Creators` into creator subfolders (Dawalixi, JimPu6, ProudBanana, Nyantcha, Sollyz, MANA), split `01_Games\Other_Games` (Slime -> Anime, Fate -> FGO, Arknights, Skyrim, etc.), and clean remaining loose files in `07_Original_Other` with 100% byte-for-byte verification.

**Architecture:**
- Global multi-phase execution scripts:
  1. `.scratch/sweep_global_torrents_and_stubs.js`
  2. `.scratch/restructure_anime_manga.js`
  3. `.scratch/consolidate_3d_creators.js`
  4. `.scratch/restructure_other_games.js`
  5. `.scratch/refine_remaining_originals.js`
- Automated atomic move & deduplication engine ensuring 0 byte loss and strict path validation.

**Tech Stack:** Node.js, Python 3.11, strict byte verification.

## Global Constraints
- Target: `F:\Doujin\`
- Absolute Protection: Never touch `E:\SuperK`, `F:\Phone_Backup`, `E:\Phone_Backup`, or developer workspaces.
- Safe-move rule: No source file may be removed until destination matches size exactly.
- Ledger: Record all moves in `docs/AI-WORKING-NOTES.md` and `.scratch/master_library_restructure_ledger.json`.

---

## Tasks

### Task 1: Global Stray Torrent Sweeping & Empty Directory Purge
**Files:**
- Create: `.scratch/sweep_global_torrents_and_stubs.js`

- [x] **Step 1: Implement torrent sweeping and empty stub cleanup**
  Find all 134 `.torrent` files across all subdirectories and move them to `F:\Doujin\_Torrents\`. Safely remove only 0-byte, 0-file empty directories.
- [x] **Step 2: Execute Task 1 runner**
  Run `node .scratch/sweep_global_torrents_and_stubs.js` and verify output.
- [x] **Step 3: Verify torrents count in `_Torrents\` and zero empty folders**

### Task 2: Restructure `02_Anime_Manga` into Dedicated Franchise Folders
**Files:**
- Create: `.scratch/restructure_anime_manga.js`

- [x] **Step 1: Implement Anime & Manga routing logic**
  Create dedicated franchise directories and route all loose files/folders:
  - `Sousou_no_Frieren\` (Fern, Stark, Frieren volumes)
  - `KonoSuba\` (Megumin, Darkness)
  - `Black_Clover\` (Noelle, Dorothy, Black7)
  - `Dr_Stone\` (Kohaku, Suika)
  - `Jujutsu_Kaisen\` (Nobara, Mai, Merkonig)
  - `Mato_Seihei_no_Slave\` (Mimonel)
  - `The_100_Girlfriends\` (shasha_inu)
  - `Dragon_Ball\` (Yamamoto Fusion, etc.)
  - `Kill_la_Kill\`, `Detective_Conan\`, `Toradora\`, `DanMachi\`
- [x] **Step 2: Execute Task 2 runner**
  Run `node .scratch/restructure_anime_manga.js`.
- [x] **Step 3: Verify `02_Anime_Manga` root contains only clean franchise folders**

### Task 3: Consolidate `04_3D_Creators` into Creator Folders
**Files:**
- Create: `.scratch/consolidate_3d_creators.js`

- [x] **Step 1: Implement 3D Creator clustering logic**
  Move all 67 loose files in `04_3D_Creators` into matching creator folders:
  - `Dawalixi\` (all loose Dawalixi volumes)
  - `JimPu6\` (all loose JimPu6 volumes)
  - `Nyantcha\` (all loose Nyantcha / ThiccwithaQ volumes)
  - `ProudBanana\` (all loose ProudBanana volumes)
  - `Sollyz_Sundyz\` (all loose Sollyz / Sundyz volumes)
  - `MANA_Kenja_Time\` (all loose MANA volumes)
  - `Fellatrix\`, `Frozenspiderlily\`, `Terasu_MC\`, `kcccc\`, `Asanagi_Fatalpulse\`
- [x] **Step 2: Execute Task 3 runner**
  Run `node .scratch/consolidate_3d_creators.js`.
- [x] **Step 3: Verify `04_3D_Creators` root is consolidated**

### Task 4: Restructure `01_Games\Other_Games`
**Files:**
- Create: `.scratch/restructure_other_games.js`

- [x] **Step 1: Implement Other Games re-routing logic**
  - Tensei Shitara Slime Datta Ken (12 items) -> `02_Anime_Manga\Tensei_Slime\`
  - Fate / Grand Order (10 items) -> `01_Games\Fate_Grand_Order\`
  - Monster Hunter (3 items) -> `01_Games\Monster_Hunter\`
  - Arknights (2 items) -> `01_Games\Arknights\`
  - Skyrim (Slave City) -> `01_Games\Skyrim\`
  - Dead by Daylight -> `01_Games\Dead_by_Daylight\`
  - League of Legends -> `01_Games\League_of_Legends\`
  - Project KV -> `01_Games\Project_KV\`
  - Kantai Collection -> `01_Games\Kantai_Collection\`
  - The Idolmaster -> `01_Games\Idolmaster\`
- [x] **Step 2: Execute Task 4 runner**
  Run `node .scratch/restructure_other_games.js`.
- [x] **Step 3: Verify `01_Games` subfolders and empty `Other_Games` status**

### Task 5: Deep Scan & Refining of `07_Original_Other`
**Files:**
- Create: `.scratch/refine_remaining_originals.js`

- [x] **Step 1: Route remaining franchise and studio items**
  - ZZZ: `paizuri-zone-zero`, `Shikyū ijime rareru niko` -> `01_Games\Zenless_Zone_Zero\`
  - Idolmaster: `Kotone Fujita` -> `01_Games\Idolmaster\`
  - Wuthering Waves: `Zani_Daily_Emote_Set*` -> `01_Games\Wuthering_Waves\`
  - Black Clover: `Scarose_Black_Clover`, `Dorothy partys` -> `02_Anime_Manga\Black_Clover\`
  - Thai Translated: `กานยูแสนสุดลามก`, `ถ้าเกิดว่า...`, `SuperK_Translations` -> `05_Thai_Translated\`
  - Genshin Impact: `心海大人不會認輸` -> `01_Games\Genshin_Impact\`
  - VTuber: `Hime Hajime`, `houk1se1_202209` -> `03_VTuber\`
  - Taimanin: `[JJ.JJ]_Tentacle_Seedbed_Taimanin_Yukikaze` -> `01_Games\Taimanin\`
  - 3D Creators: `[JJ.JJ]_101*`, `[jj.jj]_93-96*` -> `04_3D_Creators\JJ_JJ\`, `[kcccc]*` -> `kcccc\`
  - Studio grouping: `(同人誌) [FLAT] 俺のヒミツに触れる指` -> `Finger_Secret\`, `Chihel` -> `Pixiv_Fanbox_Originals\`
  - System presets: `bugreport-*.zip`, `alight_motion_xml_*.zip`, `คนเหนื่อย.lnk` -> `_System_Presets\`
- [x] **Step 2: Execute Task 5 runner**
  Run `node .scratch/refine_remaining_originals.js`.
- [x] **Step 3: Verify `07_Original_Other` contains only true original books and studio folders**

### Task 6: Master Indexing & Documentation Update
**Files:**
- Modify: `docs/AI-WORKING-NOTES.md`

- [x] **Step 1: Run comprehensive library catalog indexing across all categories**
- [x] **Step 2: Update `docs/AI-WORKING-NOTES.md` with verification evidence and disk health**

### Task 7: `05_Thai_Translated` Library Purification & Non-Thai Relocation
**Files:**
- Create: `.scratch/plan_accurate_non_thai_moves.js`, `.scratch/execute_accurate_non_thai_migration.js`
- Modify: `docs/AI-WORKING-NOTES.md`

- [x] **Step 1: Deep audit language authenticity across all 190 items in `05_Thai_Translated\`**
- [x] **Step 2: Safely migrate 99 non-Thai works (Genshin, Star Rail, Spy x Family, Chousiki, etc.) to proper target franchise directories with 18 exact duplicates removed and 0 data loss**
- [x] **Step 3: Verify remaining 91 items in `05_Thai_Translated\` are 100% genuine Thai-translated works or translation archives**
- [x] **Step 4: Execute Grilling deduplication policy (Q1-Q4 Option A, Q5 Option B): purge redundant collection folders ('แปลจนตัวแตก' & '_from_E_Do'), purge 5 unpacked duplicate folders, purge 6 Google Takeout timestamp zips, purge 2 chapter splits, and rename collision files; recovered 1.29 GB (61.34 GB Free)**


