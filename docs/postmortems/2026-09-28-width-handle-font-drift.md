# Post-mortem: Visible font drift during width resize

## Summary

The current source could change a new bubble's visible font from `bold 29px` to `bold 30px` on the first right-middle width-handle move. The width handler rounded the captured base font before multiplying it back for rendering. The fix preserves the fractional base and sends width preview, restore, and export through one fixed-font layout helper. This post-mortem covers the deterministic source regression; it does not establish that this exact mechanism caused the user's earlier report of a persistent font shrink.

## Symptom

The regression test `keeps a new bubble's visible font fixed through wide-narrow-wide drag at 44% zoom` used a new bubble with `fontSizeMultiplier = 3`. Before the fix, its canvas context changed from `bold 29px` before movement to `bold 30px` during the first width move. That test established a visible font-size change, but in the opposite direction from the user's reported shrink.

The user's session used `SuperK-Launcher.vbs`. The Launcher can reuse an existing server on port 3000 without checking its project path; that port was closed during investigation, so the bundle from the earlier report cannot be identified retroactively.

## Root cause

On first width-pointerdown, `lib/translationOverlay.ts` read the current visible `fontSize`, divided by the global and bubble multipliers, then rounded and clamped the base value before assigning `b.targetFontSize`. With a visible size of 29px and a combined multiplier of 3, the base became `round(29 / 3) = 10`; the render path multiplied it back to `round(10 * 3) = 30px`. The early quantization discarded the fractional base needed to reproduce the visible size.

The same gesture path also used an infinite estimated line count for width reflow. That did not create a nonterminating loop: the first candidate passed its infinite-height condition. For oval boxes it did produce an invalid chord estimate. It was a separate geometry defect, not the cause of the font-size drift.

## Why it produced the symptom

The user sees the rounded canvas font, while `targetFontSize` stores the base font before multipliers. Rounding that base before multiplying back changes the final visible integer size. The issue appears only for multiplier/base combinations where the lost fraction crosses a visible-size rounding boundary.

## Fix

On the `codex/width-handle-stability` branch, first width movement stores the exact fractional base `visibleFontSize / (globalMultiplier * bubbleMultiplier)` without rounding or clamping it early. The renderer derives the visible integer size at the end of the same calculation for every width. A bounded shared helper now supplies line wrapping, height, and overflow to width preview, canvas rendering, and the readability scanner.

The implementation also fixes lifecycle cases found during review: no-op pointer events do not convert legacy records; a real first width gesture does, even if the user returns to the starting width; cancel restores the true original snapshot; auto-grown legacy height is not captured as a manual minimum; and valid tall fixed-font records keep their top on restore and match scanner geometry.

## How it was found

- A source-aligned DOM interaction test reproduced the visible font change at 44% zoom.
- Tracing the first width move showed the base-size rounding and multiplier round-trip.
- The `Infinity` hypothesis was tested and rejected as the cause of a hang or font shrink; the loop exits on its first candidate.
- New tests were run red before implementation. Independent spec, standards, and final-verification reviews found lifecycle and restore edge cases; each was added as a regression test and fixed.

## Why it slipped through

Existing width tests checked that `fontSizeMultiplier` stayed constant. They did not assert the actual rendered `ctx.font` on each frame for a fresh bubble with a fractional base after division by its multipliers. Existing tests also did not cover no-op legacy pointer events, out-of-page cancel snapshots, or saved tall fixed-font restoration.

## Validation

- Focused run: **4 files / 65 tests passed**.
- Touched-file ESLint passed; `git diff --check` passed with Windows line-ending notices.
- The full run reported **157 files passed, 1 failed, 1 skipped; 1,039 tests passed and 6 skipped**. The failed `tests/api/nextServer.integration.test.ts` could not start its private Next server: sandboxed startup received `Access is denied` creating `.next/dev/lock`; an elevated retry reached Next but Turbopack rejected the worktree's external `node_modules` junction.
- TypeScript reports a generated Next route-type error for `_resetSettingsForTest`, which is already exported by `src/app/api/extension/settings/route.ts` at base commit `389438ba9e660a8c56e9900400affb254c9f7fc2`.
- The exact historical font-shrink direction and real-browser behavior have not been verified. The browser replay in ticket 05 remains a follow-up gate.

## Action items

- Complete ticket 05 with a clean real-browser replay using a translated page, including reload, undo/redo, text edit, export, and corner scaling.
- If the user's persistent shrink still reproduces after that replay, record the served bundle identity and trace its exact font values before attributing it to this source regression.
