# 0018. Content-Driven Bubble Reflow and Top-Anchored Auto-Height

Date: 2026-09-27

## Status

Accepted — Shared Understanding confirmed on 2026-09-27 following `/grill-with-docs` session.

## Context

Prior to this decision, dragging the right-side edge handle (`width`) of a translated bubble scaled `b.fontSizeMultiplier = rInitFontMult * widthRatio`. When a user attempted to make a horizontal speech bubble narrower to fit a vertical manga dialogue balloon:
1. The font shrank down proportionally into tiny, microscopic text instead of wrapping words into multiple lines at the intended font size.
2. Upon pointer release, an aggressive radial Frame Floor loop attempted to grow both width and height by 1.12x up to 2.5x whenever the text could not fit, ballooning the bubble back out against the user's explicit width adjustment.
3. The application lacked a dedicated separation between changing column width (text reflow) and scaling the entire bubble proportionally (proportional zoom).

A user recording (`2026-09-27 21-17-08.mkv`) demonstrated the desired behavior modeled after Torii Translate: dragging the side handle narrows the column width, wraps text lines dynamically without altering font size, and automatically expands the frame height downward to fit the reflowed line stack.

## Decision

1. **Separation of Handle Responsibilities**:
   - **Corner Scale Handle (`ne` / top-right)**: Dedicated to proportional zoom. It scales both bounding frame dimensions and `b.fontSizeMultiplier` proportionally.
   - **Side Width Handle (`e` / right edge)**: Dedicated to **Content-driven bubble reflow**. It changes only `currentBw` and strictly preserves `b.fontSizeMultiplier`.
   - **Rotate Handle (`nw` / top-left)**: Dedicated to rotating the bubble.
   - **Move Handle (`sw` / bottom-left)**: Dedicated to dragging the bubble position.
   - **Bottom Handle**: Explicitly deferred by user decision; the 4-handle layout is maintained.

2. **Top-Anchored Vertical Expansion**:
   - When text reflows into more or fewer lines due to width adjustment, the bubble frame is **Top-Anchored**: `currentBy` remains stationary at the top, and `currentBh` automatically expands or contracts downward:
     $$\text{currentBh} = \max(\text{minHeight}, \text{lineCount} \times \text{lineH} + \text{verticalPadding})$$
   - This ensures the floating quick toolbar anchored above the bubble does not jump or oscillate while dragging.

3. **Word-Breaking Fallback and Minimum Width**:
   - The bubble width allows narrowing down to a safe minimum width floor ($\approx 30\text{px}$).
   - If the width is narrower than an unbroken Thai or English word, the text engine allows syllable / character break fallback, enabling slender vertical manga columns.

4. **Frame Floor Modernization (Width-Locked Height Accommodation)**:
   - When text is edited, font size is changed via toolbar, or width is adjusted, the engine respects the user-specified width and only expands height downward to prevent clipping. Width is never ballooned outward automatically against user intent.

5. **Persistence and Parity**:
   - The reflowed width and auto-computed height are persisted to `TranslatedBubble.layoutAdjustment` in IndexedDB.
   - Export compositing and Chrome Extension overlay consume the persisted `layoutAdjustment` identically.
