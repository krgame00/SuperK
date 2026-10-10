# Batch Auto-Organize All Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an automated mechanism to organize text bubbles across all pages in a manga document ("จัดระเบียบทุกหน้า"), resolving narrow Japanese bounding box artifacts and overlapping bubbles across the entire book with one click, while preserving manual user modifications, and automatically upon batch translation completion.

**Architecture:** Extend `lib/bubbleLayoutOptimizer.ts` with multi-page batch processing helpers and manual adjustment preservation (`userModified: true`). Connect `WorkspaceAdvancedTools` ("เครื่องมือ") and `CleaningToolbar` (`[ 🪄 จัดระเบียบ ⌄ ]`) with a unified `handleAutoOrganizeAllPages` handler in `src/app/page.tsx`, integrated with live progress toasts, IndexedDB persistence, active DOM re-rendering, and per-page translation hook.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS, Vitest.

## Global Constraints
- Responsive single-row layout in `CleaningToolbar` must not wrap or expand vertically.
- Non-blocking asynchronous processing with microtask yielding so UI remains responsive.
- Authentic Monochrome Manga Text Style (ADR 0016) and `TranslatedBubble.layoutAdjustment` persistence in IndexedDB.
- Zero data loss for manual bubble edits (`userModified: true`) and deleted bubbles.
- 100% passing tests in Vitest and clean TypeScript (`npx tsc --noEmit`).

---

### Task 1: Multi-Page Batch Optimizer Helper & Manual Edit Preservation (`lib/bubbleLayoutOptimizer.ts`, `lib/translationOverlay.ts`)

**Files:**
- Modify: `lib/bubbleLayoutOptimizer.ts`
- Modify: `lib/translationOverlay.ts`
- Test: `tests/unit/bubbleLayoutOptimizer.test.ts`

**Interfaces:**
- `OverlayAdjustment`: add optional `userModified?: boolean; isAutoOptimized?: boolean`
- Produces: `autoOrganizeAllPagesBubbles(pages: Array<{ pageUrl: string; bubbles: TranslatedBubble[]; width?: number; height?: number }>, options?: AutoOrganizeOptions): { pageResults: Map<string, TranslatedBubble[]>; totalAdjustedCount: number }`
- Behavior: preserves bubbles where `b.layoutAdjustment?.userModified === true` during optimization passes.

- [ ] **Step 1: Write failing unit tests in `tests/unit/bubbleLayoutOptimizer.test.ts`**
  Add tests verifying:
  1. `autoOrganizePageBubbles` preserves bubbles with `layoutAdjustment.userModified === true`.
  2. `autoOrganizeAllPagesBubbles` processes multiple pages, calculates geometry correctly for each, tags `isAutoOptimized: true`, and reports aggregate adjusted bubble counts.
- [ ] **Step 2: Run test to confirm failure**
  Run `npx vitest run tests/unit/bubbleLayoutOptimizer.test.ts` and verify it fails.
- [ ] **Step 3: Implement updates in `lib/bubbleLayoutOptimizer.ts` and `lib/translationOverlay.ts`**
  - In `lib/translationOverlay.ts`, update `saveAdjustment` to set `userModified: true`.
  - In `lib/bubbleLayoutOptimizer.ts`, mark generated adjustments with `isAutoOptimized: true` and preserve any bubble with `layoutAdjustment?.userModified === true`.
  - Implement `autoOrganizeAllPagesBubbles`.
- [ ] **Step 4: Run test to confirm pass**
  Run `npx vitest run tests/unit/bubbleLayoutOptimizer.test.ts` to confirm 100% green.
- [ ] **Step 5: Commit changes**
  Commit with `git commit -m "feat: add autoOrganizeAllPagesBubbles and preserve user modified bubbles"`.

---

### Task 2: Advanced Tools Menu Item (`components/workspace/WorkspaceAdvancedTools.tsx`)

**Files:**
- Modify: `components/workspace/WorkspaceAdvancedTools.tsx`
- Test: `tests/workflow/WorkspaceControls.test.tsx`

**Interfaces:**
- Consumes: `onOrganizeAllPages?: () => void`, `canOrganizeAll?: boolean` in `WorkspaceAdvancedToolsProps`
- Produces: New menu item `🪄 จัดระเบียบคำแปลทุกหน้า` in the "เครื่องมือ" menu.

- [ ] **Step 1: Write test in `tests/workflow/WorkspaceControls.test.tsx`**
  Verify the new menu item is rendered and calls `onOrganizeAllPages` when selected.
- [ ] **Step 2: Update `WorkspaceAdvancedTools.tsx`**
  Add `onOrganizeAllPages` and `canOrganizeAll` props and include the menu item.
- [ ] **Step 3: Verify tests pass**
  Run `npx vitest run tests/workflow/WorkspaceControls.test.tsx`.
- [ ] **Step 4: Commit changes**
  Commit with `git commit -m "feat: add organize all pages item to WorkspaceAdvancedTools"`.

---

### Task 3: CleaningToolbar Dropdown Action (`src/app/page.tsx`)

**Files:**
- Modify: `src/app/page.tsx`
- Test: `tests/workflow/WorkspacePage.test.tsx`

**Interfaces:**
- Upgrades `[ 🪄 จัดระเบียบ ]` button into a split or dropdown button with options:
  - `จัดระเบียบหน้านี้`
  - `จัดระเบียบทุกหน้า ({n} หน้า)`

- [ ] **Step 1: Write test in `tests/workflow/WorkspacePage.test.tsx`**
  Verify clicking the organize dropdown options triggers single-page vs all-page handlers.
- [ ] **Step 2: Implement compact dropdown in `CleaningToolbar` in `src/app/page.tsx`**
  Add the dropdown menu with accessibility attributes, outside-click dismissal, and keyboard accessibility.
- [ ] **Step 3: Verify tests pass**
  Run `npx vitest run tests/workflow/WorkspacePage.test.tsx`.
- [ ] **Step 4: Commit changes**
  Commit with `git commit -m "feat: add organize dropdown in CleaningToolbar"`.

---

### Task 4: Workspace Batch Organizer & Per-Page Translate Hook (`src/app/page.tsx`)

**Files:**
- Modify: `src/app/page.tsx`
- Test: `tests/workflow/WorkspacePage.test.tsx`

**Interfaces:**
- Implements `handleAutoOrganizeAllPages`:
  - Iterates through all translated pages in `bubbleCacheRef`
  - Resolves dimensions for each page
  - Optimizes bubbles with `forceRealign: true` while preserving `userModified: true`
  - Updates cache, IndexedDB, and active screen overlay
  - Displays live floating stopwatch progress toast
- Hooks into `handleTranslateAll`:
  - Automatically runs per-page auto-organize upon arrival of each translated page during batch translation.

- [ ] **Step 1: Write integration test in `tests/workflow/WorkspacePage.test.tsx`**
  Verify batch organize processes all pages and updates their bubble caches.
- [ ] **Step 2: Implement `handleAutoOrganizeAllPages` in `src/app/page.tsx`**
- [ ] **Step 3: Wire into per-page arrival in batch translation**
- [ ] **Step 4: Run test suite**
  Run `npx vitest run tests/workflow/WorkspacePage.test.tsx`.
- [ ] **Step 5: Commit changes**
  Commit with `git commit -m "feat: implement handleAutoOrganizeAllPages and hook into batch translation"`.

---

### Task 5: Full Build, Verification & Working Notes Update

**Files:**
- Modify: `docs/AI-WORKING-NOTES.md`

- [ ] **Step 1: Run full Vitest test suite**
  `npm test`
- [ ] **Step 2: Run TypeScript check**
  `npx tsc --noEmit`
- [ ] **Step 3: Build Standalone Production bundle**
  `npm run build && node scripts/sync-standalone-assets.mjs`
- [ ] **Step 4: Restart Standalone Server on port 3000**
  Verify HTTP 200 on `http://127.0.0.1:3000`.
- [ ] **Step 5: Update `docs/AI-WORKING-NOTES.md`**
  Record `VERIFIED WORKING` status with verification evidence.
- [ ] **Step 6: Push commits to remote `main`**
