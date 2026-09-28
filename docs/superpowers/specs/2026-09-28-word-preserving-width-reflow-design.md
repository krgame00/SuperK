# Design Specification: Word-Preserving Width Reflow

- **Date:** 2026-09-28
- **Status:** User-confirmed design; implementation pending
- **Supersedes:** Word-breaking and minimum-width behavior in [the 2026-09-27 width-resize design](2026-09-27-width-resize-text-reflow-design.md)
- **Amends:** [ADR 0018](../../adr/0018-content-driven-bubble-reflow-and-top-anchored-auto-height.md)

## Problem

The side width handle currently permits a bubble to shrink to a fixed 30px floor. The fixed-font layout can then break an overlong word into graphemes, so a word may wrap one character at a time. The user wants the narrowest width to fit a complete word, matching the reference editor's word-level wrapping.

## User-Confirmed Behavior

1. **Side width handle:** Narrow or widen the text column while keeping its visible font size fixed. Wrap at complete word boundaries; do not split a word to satisfy the width. The minimum width is the width required by the widest complete word, measured with the current font and the bubble's usable text area.
2. **Language-aware boundaries:** Use word boundaries for the translated text's language and keep trailing punctuation attached to its word. If language-aware segmentation is unavailable, treat whitespace-delimited tokens as indivisible words.
3. **Bubble geometry:** Preserve the current top edge and continue the existing automatic height reflow. If the minimum width would cross the page's right edge, move the bubble left only enough to keep it on the page, preserving its vertical position. The corner scale handle remains proportional zoom.
4. **After the drag:** Keep the same whole-word line layout after pointer release, when reopening the work, and in exported output.
5. **Edited or legacy content:** If an edit or an older saved frame leaves a complete word wider than the saved frame, keep the saved width and show the existing overflow indication. Do not automatically widen the frame or split the word.
6. **Word wider than the whole page:** Preserve the complete word and report overflow if it cannot fit even when the frame uses the available page width.

## Out of Scope

- Changing the proportional zoom behavior of the corner handle or the responsibilities of the other handles.
- Automatically widening a frame after text edits.
- Character- or grapheme-level fallback wrapping.
- Changes to translation, OCR, font styling, or export formats.

## Acceptance Scenarios

- Dragging the side width handle narrower causes complete words to move to following lines; no word is split into individual characters.
- Further narrowing stops at the measured width floor for the widest word in the bubble.
- When the minimum width would leave the right edge of the page, the bubble shifts left only as much as needed and stays at the same vertical position.
- Releasing the pointer, reopening the work, and exporting preserve the same word boundaries and visible font size.
- Editing a bubble to contain a word wider than its saved frame preserves the frame width and presents the existing overflow indication.
- A word wider than the available page width remains intact and produces an overflow indication.
- Corner scaling still scales frame dimensions and font size proportionally.

## Implementation Notes

- Replace the fixed 30px width clamp for side-handle resizing with a content-derived floor. The fit calculation must account for the font metrics, text inset, and shape-specific usable width.
- Use one layout policy for preview, persisted rendering, and export so text does not reflow differently after the interaction.
- Keep the existing top-anchored height calculation and width persistence behavior.
