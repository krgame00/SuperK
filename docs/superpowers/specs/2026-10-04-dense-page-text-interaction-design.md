# Dense-page text interaction

## Intent

Reduce user-visible stutter during both text movement and proportional corner scaling on pages with many text points. Preserve text-size, layout, handle roles, tight selection bounds, editing and export behavior. A separate approved source-matched sizing feature must not introduce original-image analysis into gestures.

## Current evidence

The earlier performance fix already reuses glyph bitmaps for movement/rotation and coalesces corner/width previews by animation frame. Existing deterministic tests mainly exercise individual points. Current source reveals possible dense-page costs in per-point DOM/canvas allocation, geometry read/write ordering, chrome position reads, duplicate width-layout work and release-time style/storage work; these are hypotheses until measured. No real dense-page frame-time trace has yet established the reported cause.

## Investigation and changes

- Extend the existing browser harness with realistic 10/50/100-point pages, multiline Thai, outlines/shadows, different image resolutions and zooms. Capture baseline move/scale/width/release traces before selecting changes. Record browser/hardware, visible point count, page dimensions, zoom and timing distribution.
- Compare layout/paint, JS measurement/segmentation, memory/DOM work and release/persistence costs. Reproduce live stutter separately from a pause after releasing the pointer. Do not attribute either to React, storage or OCR without a trace through the actual path.
- Implement only optimizations supported by evidence: possible candidates are shared selected-point controls, write/read separation, one preview update per frame, reuse of unaffected text/layout, bounded metric/layout caches and moving work off the live interaction path. Avoid unrelated renderer replacement.
- Movement/rotation reuse the existing glyph bitmap. Width dragging performs live whole-word reflow with fixed visible size. Corner dragging proportionally transforms the existing lettering bitmap during the gesture; slight temporary softness is permitted. On release, render crisp glyphs at the final size with the same position, scale, anchor and line structure. Settling must not introduce a jump or reflow different from the preview.
- Release applies the final pointer coordinates exactly, produces settled high-quality text and commits one undoable operation. Pending previews cannot overwrite final or cancelled state. Cancellation restores the opening size/position/ownership; overlay replacement/unmount cancels callbacks and releases gesture resources.
- Source-size analysis, cloud calls, background detection and full-book scans stay outside the gesture path. Saving should not synchronously block live pointer preview; retain required durability and avoid stale releases or cross-page writes.
- Keep bounded caches and release resources for replaced pages. Performance improvements must not turn long-session editing into unbounded memory growth.

## Acceptance

- Measure before/after with the same scene/browser conditions. Target 60 Hz responsiveness (roughly 16.7 ms frame budget) on the reference machine for 50/100-point scenes; report actual p50/p95/max, missed-frame and input-to-preview results rather than claiming a universal hardware guarantee.
- Validate both moving and scaling, long selected text, repeated gestures, width reflow, rotation, edge clamps, final release, cancellation, no-op clicks, Undo/Redo and changing pages during a gesture.
- No change to font size during width drag, proportional corner semantics, saved coordinates or preview/export parity. No frame/toolbar jumping or extra line-break changes when settling.
- Existing burst/coalescing tests remain meaningful regression checks; real browser dense-page traces verify that reduced work improves observed interaction.
- Verify source-matched size integrated, zoom 44%/100%, saved work and long editing sessions. State any remaining slow scene or hardware limitation in the verification record.

## Delivery dependency

This work can be investigated independently of source-matched sizing. Stabilize the measured interaction path, then integrate the source-size feature and rerun the dense-page scenarios. The earlier multilingual guard is a separate task; its decisions remain preserved.

## Considered approaches

1. Chosen: measure dense-page behavior, reuse selected-point bitmaps during transform gestures and optimize evidenced layout/control costs. This preserves the current renderer and gesture semantics.
2. Fully redraw corner glyphs every frame: maintains transient sharpness but can multiply measurement/paint costs; the user explicitly accepts temporary softness for smoother interaction.
3. Replace the renderer wholesale: broader risk to export, history and handle contracts; there is no measured evidence yet that this is necessary.
