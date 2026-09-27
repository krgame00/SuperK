# Design Specification: Content-Driven Bubble Reflow and Top-Anchored Auto-Height

- **Date:** 2026-09-27
- **Author:** Antigravity / SuperK Manga Translator Team
- **Status:** Approved via `/grill-with-docs` (ADR 0018)
- **Target Area:** `lib/translationOverlay.ts`, `lib/textFitting.ts`, `types/workspace.ts`

---

## 1. Problem Statement & User Experience Goals

In manga editing, translating Japanese/Korean vertical text into Thai or English requires placing text inside narrow vertical dialogue balloons. 
Currently, SuperK's text bubble editing exhibits two critical issues:
1. **Side Handle Shrinks Font Microscopic:** When dragging the right-edge `width` handle (`e`), `translationOverlay.ts` mutates `b.fontSizeMultiplier = rInitFontMult * (currentBw / rInitBw)`. Narrowing the bubble halves the font size rather than wrapping words into multiple vertical lines.
2. **Aggressive Radial Frame Floor Ballooning:** When dragging ends, an aggressive radial loop grows both width and height by 1.12x up to 2.5x whenever the text does not fit comfortably, popping the box wider against user intent.
3. **Missing Auto-Height:** The height of the box remains fixed, requiring manual height juggling or causing text truncation.

### User Target (Modeled from Torii Translate Reference Video `2026-09-27 21-17-08.mkv`):
- Dragging the side `width` handle narrows the column width.
- The font size remains locked at its intended size.
- Text reflows dynamically into more lines.
- The frame height automatically expands downward (Top-Anchored) to fit the reflowed line count.
- The 4-handle layout (rotate, scale, width, move) is maintained without adding a bottom handle.

---

## 2. Architectural Design & Handle Separation

### 2.1 Handle Separation of Concerns
1. **Corner Scale Handle (`ne` / top-right):**
   - **Action:** Proportional Zoom.
   - **Behavior:** Scales both `currentBw` and `currentBh`, and scales `b.fontSizeMultiplier` proportionally.
2. **Side Width Handle (`e` / right-center):**
   - **Action:** **Content-Driven Bubble Reflow**.
   - **Behavior:** Updates `currentBw = Math.max(minBubbleWidth, rInitBw + dx)`.
   - **Font Size:** Strictly preserves `b.fontSizeMultiplier` (no mutation).
   - **Auto-Height:** Computes required height based on wrapped lines and expands downward.
3. **Rotate Handle (`nw` / top-left):**
   - **Action:** Rotates the bubble around center.
4. **Move Handle (`sw` / bottom-left):**
   - **Action:** Drags bubble position `(currentBx, currentBy)` across the canvas.

### 2.2 Top-Anchored Dynamic Reflow Math

While dragging the `width` handle or when text changes:
1. **Line Wrapping:**
   $$\text{fit} = \text{fitTextForBubble}(\text{text}, \text{currentBw} \times 0.92, \infty, \text{currentFontFam}, \text{fontMult}, \text{minFs})$$
2. **Height Computation:**
   $$\text{lineH} = \text{fontSize} \times 1.30$$
   $$\text{contentHeight} = \max(\text{minBubbleHeight}, \text{fit.lines.length} \times \text{lineH} + \text{verticalPadding})$$
3. **Top-Anchoring:**
   - `currentBy` remains pinned at its top coordinate:
     $$\text{currentBy}_{\text{new}} = \text{currentBy}_{\text{anchor}}$$
   - `currentBh` becomes:
     $$\text{currentBh} = \text{contentHeight}$$
   - The top floating toolbar (`bubble-quick-toolbar`) remains stable above the bubble without jumpy repositioning.

### 2.3 Word Breaking & Minimum Column Width
- Minimum width floor: $\text{minBubbleWidth} = 30\text{px}$ (or $\approx 1$ character width).
- Text wrapping in `lib/textFitting.ts`:
  - Primary: `Intl.Segmenter("th", { granularity: "word" })` and spaces for English/Thai.
  - Fallback: If a single atomic word exceeds the available line width, break the word by syllable or character so that narrow vertical manga balloons are permitted without clipping or overflowing horizontally.

### 2.4 Frame Floor Modernization (Width-Locked Height Accommodation)
- Replace the legacy radial 2.5x width+height expansion loop in `renderBubble()`:
  - If text cannot fit into `(currentBw, currentBh)`:
    - Lock `currentBw` to user-specified width.
    - Only expand `currentBh` downward to accommodate the required lines.
    - Width is NEVER expanded automatically against user intent.

---

## 3. Data Flow & Synchronization

```
User drags 'width' handle (pointermove)
               │
               ▼
   Calculate currentBw (clamped to >= 30px)
   Keep b.fontSizeMultiplier intact
               │
               ▼
   fitTextForBubble(text, currentBw * 0.92, ...)
   Calculate required lines and contentHeight
               │
               ▼
   Set currentBh = contentHeight (Top-anchored: currentBy unchanged)
               │
               ▼
   renderBubble() updates canvas & wrapper styles
   positionChromeControls() realigns toolbar & handles
               │
               ▼
Pointer Up -> saveAdjustment() -> Persist to IndexedDB & push to UndoManager
```

---

## 4. Test Strategy & Verification Plan

1. **Unit Tests (`tests/unit/translationOverlayAdjust.test.ts` & `tests/unit/textFitting.test.ts`):**
   - Assert dragging `width` changes `bw` and `bh` without mutating `fontSizeMultiplier`.
   - Assert narrowing width increases line count and increases `bh` while keeping `by` top-anchored.
   - Assert single long words break gracefully into multiple lines when width is smaller than the word.
   - Assert corner `scale` handle continues to scale `fontSizeMultiplier` and dimensions proportionally.
2. **Regression Tests (`tests/workflow/` & `tests/export/`):**
   - Assert export compositing renders reflowed multi-line text identically to the preview canvas.
   - Assert undo/redo restores previous `bw` and `bh` correctly.
3. **Gates:**
   - 0 TypeScript errors (`npx tsc --noEmit`).
   - 100% Vitest pass (`npm test`).
   - 100% Pytest pass (`ocr-service/venv/Scripts/pytest`).
