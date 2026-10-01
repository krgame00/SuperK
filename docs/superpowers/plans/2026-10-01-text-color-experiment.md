# Text Color Experiment Plan

**Goal:** Measure whether isolated glyph pixels and Lab clustering improve extraction on known synthetic source colors.

**Architecture:** Offline OpenCV experiment in ignored scratch directory; compare real current TypeScript extractor through a local Vitest harness. No production behavior changes.

- [x] Verify masked core separation with failing regression, then implement bounded extraction.
- [x] Generate deterministic colored text fixtures and compare RGB/Lab/masked methods with current extraction.
- [x] Save JSON metrics and visual report, inspect output, document limitations and decision.

Results: local two-test OpenCV regression passed after the expected failed fill-isolation assertion; actual existing TypeScript extraction comparison passed (one harness test). Six deterministic original-pixel scenes were evaluated. Core RGB and core Lab tied on every scene: five exact synthetic fill matches; thin antialiased purple remained inaccurate (Delta E 76 13.90), and the existing extractor with a glyph mask was better there (10.15). Current unmasked extraction confused dark artwork with yellow/white/purple fills. Simply supplying the glyph mask still inverted white fill/red outline. Exact core selection improved white/red separation in this controlled case.

Decision: prioritize trustworthy glyph/core segmentation and fill/outline ownership. No evidence here justifies replacing RGB with Lab globally. Do not reuse expanded cleaning masks or deploy this prototype without labeled real-page comparison. Black normalization in current code is intentional; its nonzero raw-color error is not necessarily a regression. Outline output, gradients, JPEG artifacts and automatic mask acquisition were not evaluated.

Reproducible experiment and metrics: .scratch/text-color-experiment/{experiment.py,test_experiment.py,compare.test.ts,vitest.config.mjs,report.py,metrics.json,comparison.png}. These are local ignored artifacts. No dependencies installed, production files changed, services restarted, commit or push performed.

## Real-source follow-up

User supplied a local ZIP with 33 WebP pages. Inspected introductory pages and selected 12 text crops across pages 3, 4 and 7. Local CTD model was already present; no downloads or cloud calls. Crop coordinates were manually selected, not automatic translation boxes, and no numerical ground-truth color labels were established.

The current extractor recovered visually plausible cyan/red/orange/black fills in all selected crops; inserting completed detector support did not change those extracted colors. The experimental deepest-mask-pixel method frequently selected white outline/background: detector support and completed removal support are not exact glyph contours. This falsifies using that method directly with current production masks.

Tracing the actual style resolver independently explains a color difference in output: for ordinary chromatic dialogue, Auto renders white fill and maps source color to outline. Existing source_faithful ownership keeps recovered fill color. Current extraction and faithful rendering still invent white outline in some source cases that visibly lack it; outline fidelity remains separate unresolved work. Do not call the current result exact style reproduction.

Artifacts: real_compare.py, real_report.py, real-fixtures.json, real-baseline.json, real-comparison.png in the same ignored experiment directory. The TypeScript comparison harness passed on the 12 real crops and used existing extractTextColors and resolveBubbleTextStyle. The comparison shows fill/outline swatches, not a production UI screenshot. Asked user whether to keep original fill or preserve the existing white-fill/source-colored-outline behavior before changing that established policy. No production edits or deployments in this follow-up.
