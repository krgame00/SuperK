# Width Handle Font Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the width-resize behavior in `C:\Users\PC\Videos\2026-09-27 21-17-08.mkv`: moving the right-middle handle reflows text and changes frame height live, while the visible font size stays constant through drag, release, widening again, save, and export.

**Architecture:** One bounded fixed-font layout function computes lines, required height, and overflow in source-image pixels. The interactive renderer and export readability scanner consume that result. `targetFontSize` remains the optional saved base-size lock; a new optional `manualMinHeightPx` protects a user-set frame height. Old records without `targetFontSize` keep their legacy rendering until the first width drag.

The width path's `Infinity` input does not make the candidate loop hang: its height condition exits after the first candidate. It does make oval wrapping calculate a chord as if the candidate had infinitely many lines. The shared fixed-font result removes that invalid geometry input and keeps preview, render, and scanner on the same bounded layout.

**Tech Stack:** TypeScript, Canvas 2D, Vitest/jsdom, Next.js 16 development server.

## Global Constraints

- The user confirmed that the right-middle width handle must preserve the **visible canvas font size**, not just `fontSizeMultiplier`. The corner handle and A+/A− remain explicit font-size controls.
- Use the top-anchored height behavior and four handles from [the approved design](../specs/2026-09-27-width-resize-text-reflow-design.md) and [ADR 0018](../../adr/0018-content-driven-bubble-reflow-and-top-anchored-auto-height.md). Preserve a manually set minimum height.
- Keep the left edge and user-selected width on release. If the required height exceeds the space below the frame, retain the font size and report overflow.
- Treat the supplied MKV as a **reference demonstration of Torii Translate**, not a recording of the current SuperK failure. The user's SuperK symptom is a visible font shrink during right-middle drag that remains after widening.
- `SuperK-Launcher.vbs` reuses any healthy service at port 3000 without checking its project path. Port 3000 was closed during investigation, so the earlier user session's served bundle is unknown. A source-aligned pointer test reproduces a visible font change in the current code; final browser verification must still use a server started from this checkout.
- Preserve the unrelated untracked `.zcodeignore`. Implementation is happening in the isolated managed worktree `codex/width-handle-stability`; the primary checkout's user changes remain untouched.
- Do not edit a Next.js file without first reading its relevant guide under `node_modules/next/dist/docs/`, per `AGENTS.md`.

## File map

- Create `lib/textBoxWidthLayout.ts`: deterministic, bounded fixed-font wrapping and height/overflow result.
- Modify `lib/translationOverlay.ts`: use one layout result for width preview, canvas rendering, pointer completion/cancel, and persistence; retain the legacy branch for records without a width lock.
- Modify `lib/export/readabilityScan.ts`: consume the same width-mode result and overflow flag.
- Add `tests/unit/textBoxWidthLayout.test.ts`; extend `tests/cleaning/translationOverlay.test.ts` and `tests/export/readabilityGeometry.test.ts`.
- Update this plan and `docs/AI-WORKING-NOTES.md` with measured results.

---

### Task 1: Reconcile runtime and capture the failing transition

**Files:** Read `SuperK-Launcher.vbs`, `lib/translationOverlay.ts:307-374,405-493,934-1055,1516-1678`, and existing width tests at `tests/cleaning/translationOverlay.test.ts:1099-1289`. Add no production code in this task.

**Interfaces:** Produce a short evidence record with Git SHA, browser URL, frontend PID/working directory or bundle signature, and before/during/after values for visible `ctx.font`, `b.targetFontSize`, `b.fontSizeMultiplier`, `bw`, `bh`, and `by`.

- [x] **Step 1: Pin the source being tested.** The clean managed worktree is pinned to `389438ba9e660a8c56e9900400affb254c9f7fc2` on `codex/width-handle-stability`. Port 3000 was closed. `SuperK-Launcher.vbs` was inspected: it reuses any healthy local service, otherwise starts Next from its own directory. The earlier runtime cannot be identified after its process exited.
- [x] **Step 2: Reproduce the source-level transition.** A DOM test using the real width-handle event path at a 440×528 `.tl-canvas` (44% of the 1000×1200 source) starts a new bubble at `bold 29px`, then observes `bold 30px` on the first width move when `fontSizeMultiplier=3`. The geometry and multiplier remain otherwise fixed. This reproduces a visible font change in checked-in source, but not the user's reported shrink direction.
- [x] **Step 3: Trace and falsify the `Infinity` hypothesis.** `pointermove` passed `Infinity` to `wrapTextForBubble`; its first loop candidate exits because any finite line height is `<= Infinity`. It is not a nonterminating loop. In oval mode, `getLineMaxW()` divides by an infinite candidate count and uses the minimum chord, which can distort line breaks. This explains a layout error but does not explain font shrink by itself.
- [x] **Step 4: Gate the implementation.** The repeatable source-aligned font-size change supplies a regression input for the following tickets. Keep the exact shrink direction and prior Launcher bundle provenance unresolved until the browser replay; do not attribute that specific historical observation to this source without the recording or trace.

### Task 2: Add bounded fixed-font layout

**Files:** Create `lib/textBoxWidthLayout.ts` and `tests/unit/textBoxWidthLayout.test.ts`; read the current Thai segmentation and oval chord rule in `lib/translationOverlay.ts:405-493`.

**Interfaces:** Export `layoutTextAtFixedFont(input: FixedFontWidthInput): FixedFontWidthResult`. All dimensions are source-image pixels. The function receives a text measurement callback and does not touch DOM, bubble state, or storage.

- [x] **Step 1: Write red unit cases.** Added deterministic fixed-font cases for wide→narrow→wide, Thai/English wrapping, oval chords, manual minimum, bottom overflow, blank text, and an over-wide grapheme.

```ts
const base = {
  text: "หนึ่งสองสามสี่ห้าหก", fontSizePx: 20, fontFamily: "sans-serif",
  manualMinHeightPx: 0, availableHeightPx: 500, isOval: false,
  measureText: (value: string) => [...value].length * 10,
};
const wide = layoutTextAtFixedFont({ ...base, widthPx: 240 });
const narrow = layoutTextAtFixedFont({ ...base, widthPx: 60 });
expect(narrow.fontSizePx).toBe(wide.fontSizePx);
expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
expect(narrow.heightPx).toBeGreaterThan(wide.heightPx);
expect(layoutTextAtFixedFont({ ...base, widthPx: 240 }).heightPx).toBe(wide.heightPx);
```

- [x] **Step 2: Confirm red.** The initial helper test failed with the expected missing-module error. A later oval candidate test exposed and fixed a settled-candidate edge.
- [x] **Step 3: Implement the bounded contract.** `lib/textBoxWidthLayout.ts` uses bounded candidate counts, Thai word segmentation, grapheme fallback, shared oval chord width calculation, and explicit manual-height/page-overflow results. No `Infinity` loop bound or font-fitting step remains in width reflow.

```ts
export interface FixedFontWidthInput {
  text: string;
  widthPx: number;
  fontSizePx: number;
  fontFamily: string;
  manualMinHeightPx: number;
  availableHeightPx: number;
  isOval: boolean;
  measureText: (value: string) => number;
}
export interface FixedFontWidthResult {
  lines: string[];
  fontSizePx: number;
  requiredHeightPx: number;
  heightPx: number;
  overflow: boolean;
}
const graphemes = (value: string): string[] => typeof Intl.Segmenter === "function"
  ? [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(value)]
      .map((part) => part.segment)
  : [...value];

export function layoutTextAtFixedFont(input: FixedFontWidthInput): FixedFontWidthResult {
  const safeWidth = Math.max(1, input.widthPx * 0.88);
  const availableHeight = Math.max(0, input.availableHeightPx);
  const words = input.text.split(/(\n)/).flatMap((part) => part === "\n" ? [part]
    : typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter("th", { granularity: "word" }).segment(part)]
          .map((item) => item.segment)
      : part.split(/(\s+)/));
  const maxCandidates = Math.min(256, Math.max(1,
    graphemes(input.text).length + (input.text.match(/\n/g)?.length ?? 0) + 1));
  const allowed = (index: number, count: number): number => {
    if (!input.isOval || count <= 1) return safeWidth;
    const vertical = ((index + 0.5) / count - 0.5) * 2;
    return safeWidth * Math.sqrt(Math.max(0.2, 1 - vertical * vertical)) * 0.95;
  };
  let chosen: string[] = [];
  let glyphOverflow = false;
  let settled = false;
  for (let candidate = 1; candidate <= maxCandidates; candidate++) {
    const lines: string[] = [];
    let current = "";
    let candidateOverflow = false;
    const push = () => { lines.push(current); current = ""; };
    for (const word of words) {
      if (word === "\n") { push(); continue; }
      let value = current ? word : word.trimStart();
      if (!value) continue;
      if (current && input.measureText(current + value) > allowed(lines.length, candidate)) {
        push();
        value = word.trimStart();
      }
      if (!value) continue;
      if (input.measureText(value) <= allowed(lines.length, candidate)) {
        current += value;
        continue;
      }
      for (const glyph of graphemes(value)) {
        if (current && input.measureText(current + glyph) > allowed(lines.length, candidate)) push();
        if (input.measureText(glyph) > allowed(lines.length, candidate)) candidateOverflow = true;
        current += glyph;
      }
    }
    if (current || lines.length === 0) push();
    chosen = lines;
    glyphOverflow = candidateOverflow;
    const actualChordsFit = lines.every((line, index) =>
      input.measureText(line) <= allowed(index, lines.length) * 1.05);
    if (lines.length <= candidate && actualChordsFit) { settled = true; break; }
  }
  const requiredHeightPx = Math.ceil(
    (Math.max(1, chosen.length) * input.fontSizePx * 1.30) / 0.88,
  );
  const heightPx = Math.min(availableHeight,
    Math.max(requiredHeightPx, input.manualMinHeightPx, 25));
  return { lines: chosen, fontSizePx: input.fontSizePx, requiredHeightPx, heightPx,
    overflow: !settled || glyphOverflow || requiredHeightPx > availableHeight
      || input.manualMinHeightPx > availableHeight };
}
```

- [x] **Step 4: Verify the focused helper.** Helper and fitting tests pass; the helper is included in the feature commit with its renderer/scanner integration.

### Task 3: Use one result for preview, render, release, and cancel

**Files:** Modify `lib/translationOverlay.ts:93-105,848-1055,1516-1678`; extend `tests/cleaning/translationOverlay.test.ts`.

**Interfaces:** `OverlayAdjustment` adds optional `manualMinHeightPx?: number`. A valid `targetFontSize` identifies a width-managed bubble. On first width drag, capture the displayed `fontSize` as a **fractional base**: `visibleFontSize / (globalMultiplier * bubbleMultiplier)`, with no early rounding. The renderer derives the same rounded visible font from that base at all widths. The new layout helper supplies both lines and height.

- [x] **Step 1: Write the interaction regressions.** Added the 44% zoom wide→narrow→wide case, font and line assertions, pointer cancel including an out-of-page top, no-op and zero-width moves, saved manual minimum, auto-grown legacy height, overflow, undo, and coalescing. Existing corner scale and A+/A− tests stay green.
- [x] **Step 2: Confirm the red signal safely.** The bounded helper's missing-module test failed as expected. New interaction tests then failed on 29px→30px font drift, pointercancel committing intermediate geometry, and immediate per-event rendering instead of frame coalescing. No timeout was needed because the `Infinity` loop exits on its first candidate.
- [x] **Step 3: Replace the duplicate width-drag calculation.** Pointerdown captures the displayed font as a fractional base and true original geometry. A separate page-safe drag anchor clamps an out-of-page top once; cancel and undo retain the original top. Pointermove applies fixed-font reflow, and multiple moves coalesce into one animation-frame render. Stationary and zero-width moves do not convert a legacy record. No call passes `Infinity` to `wrapTextForBubble`.

  Initialize `manualMinHeightPx` from an existing saved adjustment's `bh` on its first width drag; for a never-adjusted bubble use 25px. Subsequent side drags keep that minimum. A completed corner drag replaces it with the height the user set. Clamp a pre-existing out-of-page top to the drawable page once before starting the drag, then keep it fixed during the gesture.

```ts
const startVisibleFontPx = measureBubbleRenderFit(
  text, currentBw, currentBh, iw, currentFontFam,
  globalMultiplier, bubbleMultiplier, !b.isInvalidBox, b.targetFontSize,
).fontSize;
if (id === "width" && !(typeof b.targetFontSize === "number"
    && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0)) {
  b.targetFontSize = startVisibleFontPx / (globalMultiplier * bubbleMultiplier);
}
// During width drag: currentBw follows dx; font multiplier and target stay fixed.
// Keep rInitBy as the true undo/cancel snapshot; use a separately clamped
// rDragInitBy for the active gesture and page-height calculation.
// Both preview and renderBubble call layoutTextAtFixedFont with the same inputs.
```

- [x] **Step 4: Commit/revert exactly once.** Fixed-font render uses the shared helper and skips legacy frame growth. Pointerup flushes/saves one completed width gesture; pointercancel cancels pending work and restores the full snapshot without persistence. Corner scaling and A+/A− retain explicit font sizing. The manual minimum persists.
- [x] **Step 5: Run focused overlay tests.** Font stability, zero-move no-op, wide→narrow→wide reflow, clamped drag anchor/cancel restore, saved manual minimum, overflow badge, corner scaling, and frame coalescing all pass.

### Task 4: Align restore, scanner, and exported canvas

**Files:** Modify `lib/export/readabilityScan.ts:89-139`; extend `tests/export/readabilityGeometry.test.ts` and an existing restore test only if the save/restore path needs an explicit fixture.

**Interfaces:** A saved width-managed adjustment carries `targetFontSize` and optional `manualMinHeightPx`. The scanner passes the same source-pixel width, fixed visible font, and available height to `layoutTextAtFixedFont`; it records the helper's lines/height/font and reports its overflow flag. Offscreen export already uses `applyTranslationOverlay` and thus the renderer branch from Task 3.

- [x] **Step 1: Write red parity cases.** Added scanner cases for manual minimum, bottom overflow, and preservation of a legitimate tall width-managed frame; renderer tests cover restore geometry.
- [x] **Step 2: Run the focused scanner test.** The earlier scanner regression was red at 40px vs a saved 120px minimum; the new tall-frame restore case also fails in the renderer before the repair is guarded.
- [x] **Step 3: Route width-managed geometry through the helper.** The renderer and scanner use the shared helper for valid saved targets. Legacy records retain their existing fit/growth behavior; the oversized legacy repair no longer recenters valid width-managed frames.
- [x] **Step 4: Re-run parity.** Focused renderer/scanner checks pass for lines, visible font, height, top, manual minimum, and overflow; the implementation will be committed as one integrated change.

### Task 5: Verify the reference behavior in the real app

**Files:** Update this plan and `docs/AI-WORKING-NOTES.md` with outcomes and exact command outputs.

- [x] **Step 1: Automated gates.** Focused tests pass **4 files / 65 tests** and touched-file ESLint passes. The full Vitest suite reported **157 files passed, 1 failed, 1 skipped; 1,039 tests passed and 6 skipped**. Its only failure was `tests/api/nextServer.integration.test.ts`: the sandbox denied `.next/dev/lock`; an elevated retry reached Next but Turbopack rejected the worktree's external `node_modules` junction. TypeScript reports a generated Next route type error for the pre-existing `_resetSettingsForTest` export (present at base SHA). These environment failures are recorded below.
- [ ] **Step 2: Browser replay.** Start the verified current frontend. At 44% image zoom, use the same manga page and right-middle handle sequence seen near 6s→20s of the reference video. Confirm visible glyph size stays fixed as the box becomes a tall narrow column, height follows content, widening restores fewer lines, and no pointer-release jump occurs. Repeat after reload, undo/redo, text edit, and export. Confirm the corner handle can still scale font.
- [x] **Step 3: Review actual scope.** `git diff --check` and independent code/spec/standards reviews have been run; all concrete findings were addressed with tests. Primary-checkout user changes were kept separate and untouched. The real-browser replay remains pending and the full-suite Next integration server could not start in this worktree, so this is not marked fully verified.

## Execution evidence and remaining limit

- Reference frames at 6s and 20s were inspected from the supplied MKV; they show a wide text box becoming a narrow multi-line column.
- Source-level transition values: `bold 29px` before width movement → `bold 30px` during the first movement for the reproducible `fontSizeMultiplier=3` case. Removing integer/minimum rounding from the captured base size keeps every preview at the original visible pixel size.
- Red/green verification to date: helper regression **6/6 passed**; focus on new-font, cancel, manual-minimum, overflow, width, corner-scale, coalescing, no-op click, out-of-page cancel, and tall-frame restore interactions passed; scanner geometry now covers manual minimum and tall-frame parity. The latest focused run was **4 files / 65 tests passed**. Initial baseline was **3 files / 47 tests passed**. Canvas-dependent jsdom tests print its existing unsupported-`getContext()` warning.
- Touched-file ESLint passed. `git diff --check` passed with Windows line-ending notices. TypeScript fails only on generated `.next/dev/types/app/api/extension/settings/route.ts` because Next rejects the `_resetSettingsForTest` export already present in `src/app/api/extension/settings/route.ts` at base SHA `389438ba9e660a8c56e9900400affb254c9f7fc2`. The full suite passed 157 files; the only failed suite was the Next API server integration harness. Sandboxed startup failed to acquire `.next/dev/lock`; elevated startup confirmed Turbopack rejects this worktree's `node_modules` junction as an external symlink, so its five tests could not run.
- Browser runtime provenance from the earlier user session remains unknown because port 3000 was not running. A clean server and browser replay at 44% zoom are still required before calling the reported shrink direction verified.

## Ticket handoff — 2026-09-28

The user approved five vertical slices in the local issue tracker: 01 runtime provenance/reproduction (no blocker), 02 ordinary width-reflow path (blocked by 01), 03 oval/narrow text/page overflow (blocked by 02), 04 manual height/edit lifecycle (blocked by 02), and 05 real-browser/export verification (blocked by 03 and 04). Ticket 01 source/Launcher checks are complete, but the old browser bundle cannot be identified retroactively. Tickets 02–04 are implemented and pass focused automated checks. Ticket 05 remains pending real browser replay with a translated page; no sample translation job was available, and existing user browser data was left untouched. The full suite's lone failure is limited to starting the Next integration server under this worktree's filesystem/junction setup.
