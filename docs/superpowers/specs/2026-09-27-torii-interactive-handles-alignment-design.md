# Design Specification: Torii-Aligned Interactive Handles and Ergonomics

- **Date:** 2026-09-27
- **Author:** Antigravity / SuperK Manga Translator Team
- **Status:** Approved via Grilling Session
- **Target Area:** `lib/translationOverlay.ts`, `tests/cleaning/translationOverlay.test.ts`, `tests/unit/translationOverlayAdjust.test.ts`
- **Reference System:** Torii Translate (`gkdekajjngdkocgiealohleibhdjhoed`, `translate.js`, `metadata.json`, and video `2026-09-27 21-17-08.mkv`)

---

## 1. Executive Summary & Objective

In the previous milestone, SuperK successfully implemented the single-handle width reflow with top-anchored auto-height (verified with 1,018 tests passing). 

In this milestone, we align the entire 4-handle interactive system with **Torii Translate's proven scanlation ergonomics**:
1. **Rotate Handle (`nw` / Top-Left):** Add **Magnetic Right-Angle Snapping** (`snapRotationToRightAngle`) so that rotating near 0°, 90°, 180°, or 270° snaps crisply into place.
2. **Scale Handle (`ne` / Top-Right):** Align with Torii's font-size driving behavior, smoothly scaling text size and frame together proportionally from corner drag without clipping or text overflow.
3. **Width Reflow Handle (`e` / Right-Center):** Retain our verified top-anchored auto-height width reflow handle, styled with Torii's crisp `◀ ▶` vector SVG.
4. **Move Handle (`sw` / Bottom-Left):** Align with Torii's 4-way move crosshair icon, maintaining instant draggable access.
5. **Visual Styling & Micro-interactions:** Adopt Torii's 36px circular white pills, 2.5px `#3b82f6` border, subtle elevation shadow, and hover glow states.

---

## 2. Detailed Technical Design & Decisions (Grilling Outcomes)

### 2.1 Rotate Handle with 90° Magnetic Snapping (`snapRotationToRightAngle`)
- **Position:** `nw` (top-left corner).
- **Icon:** SVG circular clockwise arc arrow (matching Torii):
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
    <path d="M21 3v5h-5"/>
  </svg>
  ```
- **Snap Mathematics:**
  - Standard rotation angle: $\theta \in [0, 360)$ degrees.
  - Snap threshold: $\delta_{\text{snap}} = 6^\circ$ ($0.105$ rad).
  - Target right angles: $0^\circ, 90^\circ, 180^\circ, 270^\circ, 360^\circ$.
  - Snapping formula:
    ```typescript
    export function snapRotationToRightAngle(deg: number, thresholdDeg = 6): number {
      const normalized = ((deg % 360) + 360) % 360;
      const nearestQuarter = Math.round(normalized / 90) * 90;
      if (Math.abs(normalized - nearestQuarter) <= thresholdDeg) {
        return nearestQuarter % 360;
      }
      return normalized;
    }
    ```
  - When $\theta$ is within $\pm 6^\circ$ of a cardinal right angle, snap to that exact angle. Outside the threshold, allow smooth 360-degree rotation.

---

### 2.2 Top-Right Scale / Font-Size Driving Handle
- **Position:** `ne` (top-right corner).
- **Icon:** SVG diagonal double-headed arrow (NE-SW `nesw-resize`):
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="15 3 21 3 21 9"/>
    <polyline points="9 21 3 21 3 15"/>
    <line x1="21" x2="14" y1="3" y2="10"/>
    <line x1="3" x2="10" y1="21" y2="14"/>
  </svg>
  ```
- **Behavior:**
  - On pointer down: record `rInitCornerDist = Math.max(1, Math.sqrt((rStartX - rCenterX)**2 + (rStartY - rCenterY)**2))`, `rInitFontMult`, and initial `currentBw, currentBh`.
  - On pointer move:
    - Compute current distance from center: `dist = Math.sqrt((e.clientX - rCenterX)**2 + (e.clientY - rCenterY)**2)`.
    - Compute scaling ratio: `ratio = dist / rInitCornerDist`.
    - Clamp ratio safely between $0.4\times$ and $3.0\times$.
    - Scale font size multiplier: `b.fontSizeMultiplier = Math.max(0.4, Math.min(3.0, rInitFontMult * ratio))`.
    - Scale bounding box: `currentBw = Math.max(30, rInitBw * ratio); currentBh = Math.max(25, rInitBh * ratio)`.
    - Pin center or anchor appropriately so scaling expands evenly from the bubble's center point.

---

### 2.3 Right Width Reflow Handle
- **Position:** `e` (right-center edge).
- **Icon:** SVG horizontal bidirectional arrow `◀ ▶`:
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="6,8 2,12 6,16" fill="#2563eb"/>
    <polygon points="18,8 22,12 18,16" fill="#2563eb"/>
    <line x1="4" y1="12" x2="20" y2="12"/>
  </svg>
  ```
- **Behavior:**
  - Preserves `fontSizeMultiplier` and `targetFontSize` strictly.
  - Dynamically recalculates line breaks with syllable/word boundary breaking.
  - Automatically expands height downward (Top-Anchored).

---

### 2.4 Move Handle
- **Position:** `sw` (bottom-left corner).
- **Icon:** SVG 4-way crosshair move arrows:
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="5 9 2 12 5 15"/>
    <polyline points="9 5 12 2 15 5"/>
    <polyline points="15 19 12 22 9 19"/>
    <polyline points="19 9 22 12 19 15"/>
    <line x1="2" x2="22" y1="12" y2="12"/>
    <line x1="12" x2="12" y1="2" y2="22"/>
  </svg>
  ```
- **Behavior:**
  - Visible on selected bubble and hover states.
  - Direct pointer drag moves `(currentBx, currentBy)` across the image space.

---

### 2.5 Visual Styling & Handle Tokens

| Property | Value | Notes |
| :--- | :--- | :--- |
| **Size** | `36px` $\times$ `36px` | Torii standard touch & cursor target |
| **Shape** | Circular (`border-radius: 50%`) | Clean circular badge |
| **Background** | `#ffffff` | High contrast against manga tones |
| **Border** | `2.5px solid #3b82f6` | Vibrant brand blue |
| **Icon Color** | `#2563eb` | Legible vector contrast |
| **Box Shadow** | `0 3px 10px rgba(0, 0, 0, 0.35)` | Elevation depth |
| **Hover State** | Border `#1d4ed8`, Glow `0 6px 16px rgba(37,99,235,0.45)`, scale `1.05` | Tactile feedback |
| **Z-Index** | `45` | Positioned above canvas, below quick toolbar (`50`) |

---

## 3. Data Flow & Persistence

```
Pointer Drag on Handle (pointermove)
                 │
                 ├── Rotate (nw): Calculate atan2 angle -> snapRotationToRightAngle()
                 ├── Scale (ne): Calculate corner dist ratio -> scale font & bounds
                 ├── Width (e): Update currentBw -> top-anchored text reflow auto-height
                 └── Move (sw): Offset (currentBx, currentBy)
                 │
                 ▼
          renderBubble()
    Re-render text & position chrome
                 │
                 ▼
Pointer Up (commit)
                 │
                 ├── push to undoManager (full reversible state: bx, by, bw, bh, rot, fs)
                 └── saveAdjustment() -> Sync to IndexedDB & notify onBubblesMutated()
```

---

## 4. Verification & Testing Strategy

1. **Unit Tests (`tests/cleaning/translationOverlay.test.ts` & `tests/unit/translationOverlayAdjust.test.ts`):**
   - Test `snapRotationToRightAngle`:
     - Values within $\pm 6^\circ$ of 0°, 90°, 180°, 270° snap to exact multiples of 90.
     - Values outside threshold (e.g. 15°, 45°, 75°) remain unchanged.
     - Negative angles and angles $> 360^\circ$ normalize and snap accurately.
   - Test Scale handle:
     - Dragging `ne` handle updates `b.fontSizeMultiplier` and bounds proportionally.
   - Test Width handle:
     - Dragging `e` handle reflows lines with top anchor.
   - Test Undo / Redo:
     - Undoing rotation restores previous angle.
     - Redoing rotation restores snapped angle.
2. **Regression Baseline:**
   - All 1,018 existing test suites must continue to pass with zero regressions.
