# Uniform corner scaling

User explicitly requested that the corner size handle only enlarge/reduce the object, without independently changing frame length. Current corner drag independently applies horizontal width and vertical height deltas; font multiplier follows height only. This distorts aspect ratio and differs between freshly fitted and fixed-font bubbles.

Use one uniform scale from the pointer's projection on the initial top-right diagonal. Anchor the opposite bottom-left corner. Multiply initial width, height and font multiplier by the same clamped scale. Freeze the initially rendered font base for fresh bubbles when scaling begins. Width side handle retains its approved fixed-font reflow behavior. Preserve cancellation, Undo/Redo and saved geometry.

Regression checks: horizontal-only and vertical-only corner movement at zoom 44%, diagonal movement, fixed-font and fresh bubbles, cancellation and Undo/Redo. No commit/push requested. Runtime restart timing requires saved-work confirmation.

## Implementation and evidence

The corner now projects pointer movement onto the initial corner diagonal. The same factor controls width, height and font multiplier. Its font base is captured from the actual drawn font, including existing renderer clamps. Minimum scale respects 20px width, 25px height, 8px font and the existing 0.4–3 font multiplier range, so reaching a minimum cannot stretch just one axis.

Regression tests first reproduced independent-axis stretching at 44% zoom. Additional red tests reproduced height-floor stretching and the font floor mismatch; both now pass. Cancellation and Undo/Redo use a fresh matching module instance in the test harness. Verification: 138 tests passed in 13 overlay/export integration files, TypeScript passed. Independent reviewer reran 9 corner tests and found no remaining important defect. User approved web restart after saving their work.
