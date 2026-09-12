# Source-Faithful Manga Text Style Matching — Adaptive Readable + Outline Revision

**Triage:** `ready-for-agent`

## Problem Statement

SuperK should preserve the visual style of source manga text when that style can be recovered reliably, but it must not produce translated text that becomes difficult to read because the automatic source match or fallback color blends into the actual background.

The previous revision added a Source style evidence gate and readability validation so surrounding artwork, floor texture, shadows, trim colors, and other non-glyph pixels could not be promoted to source style merely because they formed a high-confidence color cluster. That solved one class of regression, but a second user-visible failure remains: the Readable fallback itself can still be unreadable when it uses a fixed light/white text preset over a light speech balloon, bright skin, highlights, glow, or other locally bright artwork.

The reported failure demonstrates that a static “white fill + dark outline” fallback is not universally readable. A text region may cross several background tones at once, and the average OCR box color is not sufficient evidence for what appears directly beneath the translated glyphs. A fallback that looks safe on one half of the region can disappear on another half.

The design therefore needs to distinguish three separate concerns:

- **Source-faithful rendering:** preserve the validated source style, including genuine no-outline text, when source evidence is trustworthy and the automatic result is legible.
- **Adaptive Readable fallback:** when source recovery is invalid or insufficient, choose a safe fill/outline pair against the real cleaned background under the translated glyph footprint rather than using a fixed white preset.
- **Manual style ownership:** preserve exactly what the user selected even if it would fail automatic readability checks; automatic safety logic may warn but must not rewrite Manual style.

The desired result is that Auto remains source-faithful when possible, but when it must fall back it produces text that is demonstrably readable on the page the user actually sees. Readable mode should intentionally use the same adaptive safety behavior. Readable fallback must always have an outline, while validated source text may still remain no-outline when that matches the original.

## Solution

Extend the validated source-style pipeline with an Adaptive Readable stage that evaluates the actual inpainted background beneath the translated text layout and selects a safe outlined style dynamically.

The system will:

1. Continue using the original pre-clean image as the authoritative source for Source text style profile recovery.
2. Continue requiring automatic source candidates to pass the Source style evidence gate and automatic readability validation before source-faithful rendering is admitted.
3. Preserve validated source no-outline state. The mandatory-outline rule applies only to Readable behavior and Auto → Readable fallback, not to validated source-faithful output.
4. Replace the fixed white Readable preset with an **Adaptive Readable style** selected against the Inpainted clean background that the translated text will actually cover.
5. Evaluate background evidence primarily beneath the translated glyph footprint plus a small margin, not across the entire OCR region.
6. Evaluate multiple safe fill/outline candidate pairs instead of choosing fill first and adding a fixed black outline afterward.
7. Include both light-fill/dark-outline and dark-fill/light-outline candidates, with stronger outlined variants available for complex backgrounds.
8. Always include an outline in Adaptive Readable output.
9. Prefer dark fill candidates on white or near-white speech balloons rather than rendering white text over a white balloon.
10. Score candidate readability over multiple locations beneath the translated glyph footprint and consider both broad/overall readability and a lower-percentile or worst-region measure so a small unreadable section cannot be hidden by a good average.
11. Target effective contrast of approximately `4.5:1` across most sampled text/background locations and avoid local regions falling materially below approximately `3:1` when a stronger safe candidate is available.
12. Escalate readable separation in a controlled order: normal fill + outline → thicker outline → controlled shadow/halo → optional background plate where allowed.
13. Use an initial Readable outline ratio roughly proportional to glyph size, around `0.10–0.14`, and permit escalation to roughly `0.16–0.20` on complex backgrounds when needed, while avoiding stroke widths that close counters or make Thai glyphs visually clogged.
14. Add controlled shadow/halo only after ordinary safe fill/outline candidates fail the Readability Gate; it is not applied to every fallback by default.
15. Permit automatic background plates only as a last-resort escalation for Overlay Subtitle text drawn directly over artwork. Dialogue and Narration / Panel Caption do not receive automatic plates; if they still cannot satisfy the gate after safe styling, the system keeps the strongest non-plate candidate and marks the region for review.
16. Apply Adaptive Readable behavior to every Text style category when that region enters Readable behavior: Dialogue, Narration / Panel Caption, SFX / Decorative, and Overlay Subtitle.
17. Keep the automatic fallback order: own validated source style → bounded local re-analysis → validated same-category Nearby color profile → Adaptive Readable fallback.
18. Keep Auto mode as Auto when it falls back, expose `Auto → Readable fallback`, and preserve a reason such as background contamination, insufficient source evidence, failed readability, or no validated nearby source.
19. Keep Readable as an explicit user-selectable behavior that intentionally bypasses source-faithful styling and selects an Adaptive Readable result.
20. Keep Manual authoritative. Automatic evidence, readability scoring, adaptive recoloring, outline escalation, shadow/halo, and plate logic must not mutate a Manual style.
21. Recalculate Adaptive Readable after a committed layout change that changes the translated glyph footprint, such as moving, resizing, reflowing, or changing font size. Do not recompute continuously on every pointer frame during dragging.
22. Do not recalculate Manual style after layout changes, although the UI may recalculate and surface a non-mutating low-contrast warning.
23. Use the same final resolved style and fallback/escalation state in the workspace overlay and export path.
24. Keep style-recovery and readability failure non-fatal to translation in single-page and batch workflows.
25. Introduce no additional cloud/AI request solely for adaptive readability selection or local contrast scoring.

## User Stories

1. As a manga translator, I want validated source text to preserve its original fill color, so that the translated lettering still belongs visually to the artwork.
2. As a manga translator, I want validated source text with no outline to stay no-outline, so that the readability system does not add a synthetic stroke to faithful source text.
3. As a manga translator, I want source text with a real outline to preserve its outline color and relative thickness, so that the translated result keeps the original visual weight.
4. As a manga translator, I want high-confidence source style to pass evidence validation before rendering, so that background colors are not mistaken for text colors.
5. As a manga translator, I want source style to remain legible against the actual page background before Auto accepts it, so that “source-faithful” does not mean unreadable.
6. As a manga translator, I want a fixed white fallback removed, so that bright speech balloons and bright artwork do not make fallback text disappear.
7. As a manga translator, I want Readable fallback selected against the cleaned background I will actually see, so that contrast decisions match the final rendered page.
8. As a manga translator, I want background analysis focused beneath translated glyphs rather than the whole OCR box, so that unrelated margins do not distort readability decisions.
9. As a manga translator, I want the system to test several safe fill/outline pairs, so that it can choose dark text on bright backgrounds and light text on dark backgrounds automatically.
10. As a manga translator, I want Adaptive Readable output to always have an outline, so that fallback text has a reliable separation boundary from artwork.
11. As a manga translator, I want the system to prefer dark text on a white or near-white speech balloon, so that dialogue remains immediately readable.
12. As a manga translator, I want the system to avoid choosing white fill merely because the global fallback used to be white, so that old defaults do not override local evidence.
13. As a manga translator, I want readability checked across many parts of the text, so that one bright patch cannot make part of a line disappear unnoticed.
14. As a manga translator, I want the system to consider the weaker areas of a text region as well as the average, so that readable sections cannot hide unreadable sections.
15. As a manga translator, I want most of the rendered text/background footprint to reach roughly 4.5:1 effective contrast when practical, so that fallback text is comfortably legible.
16. As a manga translator, I want severely weak local regions around 3:1 or lower to trigger a stronger safe candidate when available, so that small portions of text do not vanish.
17. As a manga translator, I want readable outline width to scale with glyph size, so that large and small translated text receive proportional separation.
18. As a manga translator, I want outline width to increase only when the background requires it, so that ordinary text does not become unnecessarily heavy.
19. As a manga translator, I want readable outline escalation capped before Thai glyph counters become clogged, so that the safety fix does not damage letter shapes.
20. As a manga translator, I want a subtle shadow or halo added only when a normal outlined candidate still fails, so that fallback styling remains visually restrained.
21. As a manga translator, I want shadow/halo to be controlled rather than a decorative glow, so that safety effects do not look like invented source styling.
22. As a manga translator, I want Overlay Subtitle text to be allowed a subtle background plate only as a final fallback, so that text over extremely complex artwork can remain readable.
23. As a manga translator, I want Dialogue to avoid automatic background plates, so that the system does not paint new rectangles into speech balloons.
24. As a manga translator, I want Narration / Panel Caption to avoid automatic background plates, so that the original panel composition is not altered unnecessarily.
25. As a manga translator, I want difficult Dialogue or Panel Caption that still fails after outline/halo escalation marked for review, so that I know which regions need manual attention.
26. As a manga translator, I want Overlay Subtitle treated separately from Narration / Panel Caption, so that artwork-overlaid lines can use stronger last-resort safety without affecting panel captions.
27. As a manga translator, I want SFX / Decorative text to use Adaptive Readable when it falls back, so that unreadable source recovery does not force muddy decorative colors.
28. As a manga translator, I want valid decorative source styling preserved when its evidence is trustworthy and legible, so that adaptive fallback does not flatten good source effects.
29. As a manga translator, I want the fallback sequence to try my own source evidence first, so that the system does not abandon a recoverable style prematurely.
30. As a manga translator, I want one bounded local re-analysis before fallback, so that uncertain but recoverable source text gets a second deterministic attempt.
31. As a manga translator, I want nearby inheritance to use only a validated same-category source profile, so that unrelated nearby lettering does not determine my style.
32. As a manga translator, I want Adaptive Readable used only after own-source, re-analysis, and validated nearby options fail, so that fallback remains the final safety path rather than the default.
33. As a manga translator, I want Auto to remain visibly Auto when it chooses Adaptive Readable, so that ownership state remains truthful.
34. As a manga translator, I want Auto to explain that it used a Readable fallback, so that I can understand why the text differs from the source.
35. As a manga translator, I want a reason such as background contamination or low readability, so that fallback review is actionable.
36. As a manga translator, I want an explicit Readable mode, so that I can intentionally prioritize legibility without manually choosing colors.
37. As a manga translator, I want Readable mode to use the same adaptive background-aware selection as Auto fallback, so that there is one coherent readability model.
38. As a manga translator, I want Manual mode to preserve exactly my selected fill, outline, opacity, gradient, glow, shadow, and other style settings, so that automation cannot silently reclaim control.
39. As a manga translator, I want a low-contrast Manual warning without automatic recoloring, so that I keep control while receiving useful feedback.
40. As a manga translator, I want returning from Manual to Auto or Readable to require an explicit action, so that ownership changes are never implicit.
41. As a manga translator, I want moving a text region to trigger a new Adaptive Readable decision after I finish the move, so that the style reflects the new background.
42. As a manga translator, I want resizing a region to trigger a new Adaptive Readable decision after the resize is committed, so that the changed glyph footprint is evaluated.
43. As a manga translator, I want changing font size or reflowing text to update Adaptive Readable after layout settles, so that the new glyph footprint remains readable.
44. As a manga translator, I do not want readability recomputed every pointer frame while dragging, so that editing remains responsive and styles do not flicker during interaction.
45. As a manga translator, I want Manual style left untouched when moving or resizing its text region, so that layout edits do not change my chosen visual style.
46. As a manga translator, I want the same Adaptive Readable decision in single-page and batch translation, so that output quality does not depend on workflow.
47. As a manga translator, I want style/readability failures to remain non-fatal in batch jobs, so that one difficult region does not stop later pages.
48. As a manga translator, I want fallback provenance saved with my project, so that reopening a page does not silently convert a fallback into a source-faithful state.
49. As a manga translator, I want ownership state saved with my project, so that Auto, Readable, and Manual still mean the same thing after reload.
50. As a manga translator, I want export to use the same final fill, outline, outline width, halo/shadow, and plate state I reviewed on screen, so that the downloaded image matches the workspace.
51. As a manga translator, I want a white speech balloon regression test, so that white fallback text can never silently disappear on a white balloon again.
52. As a manga translator, I want a mixed bright/dark artwork regression test, so that the system proves a single candidate can remain readable across a varied background.
53. As a manga translator, I want a complex-background Overlay Subtitle regression test, so that the system verifies its full escalation path when simple outline choices are insufficient.
54. As a manga translator, I want ordinary dark-background text to remain simple when a normal light-fill/dark-outline pair already passes, so that escalation is not overused.
55. As a manga translator, I want ordinary bright-background text to remain simple when a normal dark-fill/outline pair already passes, so that halo and plates are avoided unnecessarily.
56. As a manga translator, I want valid black no-outline source dialogue to remain unchanged after this revision, so that adaptive readability does not regress source fidelity.
57. As a manga translator, I want valid white no-outline source text on a dark region to remain unchanged when it passes source validation, so that mandatory outline remains limited to the Readable path.
58. As a manga translator, I want valid colored source text to remain colored when admitted, so that safe fallback does not flatten legitimate source design.
59. As a manga translator, I want gradient, glow, and shadow preserved only when they belong to validated source style, so that readability effects are not confused with decorative source effects.
60. As a manga translator, I want Adaptive Readable halo/shadow metadata distinguishable from source decorative effects, so that persistence and UI can explain why the effect exists.
61. As a maintainer, I want source evidence validation and adaptive readability to remain separate decisions, so that source recovery and fallback safety can evolve independently.
62. As a maintainer, I want readability tested through resolved behavior rather than a private helper formula, so that the scoring algorithm can evolve without brittle tests.
63. As a maintainer, I want glyph-footprint background sampling tested from observable candidate selection, so that tests do not depend on a particular pixel iteration implementation.
64. As a maintainer, I want overall and lower-percentile readability behavior represented in tests through mixed-background fixtures, so that average-only scoring cannot return unnoticed.
65. As a maintainer, I want outline escalation tested by visible resolved outline ratios, so that simple backgrounds remain thin and difficult backgrounds can become stronger.
66. As a maintainer, I want halo/plate escalation tested only where the earlier stages fail, so that the implementation cannot apply heavy safety effects indiscriminately.
67. As a maintainer, I want automatic plate behavior restricted to Overlay Subtitle by contract-level tests, so that Dialogue and Panel Caption cannot gain plates through a refactor.
68. As a maintainer, I want committed layout changes to invalidate/recompute Adaptive Readable state while Manual remains stable, so that interaction semantics are deterministic.
69. As a maintainer, I want legacy saved profiles without adaptive-readability metadata to load safely, so that existing projects remain usable.
70. As a maintainer, I want no extra cloud request for readability selection, so that this revision does not increase API cost, latency, or quota pressure.

## Implementation Decisions

- The source-style and readable-style responsibilities remain distinct. The original pre-clean image is authoritative for Source text style profile recovery; the Inpainted clean background is authoritative for evaluating how translated text will read after cleaning.
- Automatic source style still requires the Source style evidence gate and automatic readability validation. Confidence alone never authorizes source-faithful rendering.
- Explicit no-outline remains first-class source state. A validated source profile with `hasOutline = false` renders with no stroke. The mandatory-outline rule is limited to Adaptive Readable behavior.
- The previous fixed light/white Readable fallback is replaced by Adaptive Readable selection. A white-fill/dark-outline pair remains one candidate, not the universal default.
- Background sampling for Adaptive Readable is tied to the translated glyph footprint at the resolved layout position, with a small surrounding margin for outline/halo evaluation. The entire OCR box is not the primary readability surface.
- Candidate selection evaluates fill and outline as a pair. At minimum the safe palette must include light-fill/dark-outline and dark-fill/light-outline variants, plus stronger outline variants that remain neutral and predictable.
- Adaptive Readable output always has an outline. It does not inherit source no-outline semantics because it is a safety style rather than a recovered source style.
- White or near-white speech-balloon backgrounds bias selection toward dark fill before light fill candidates, subject to the same final readability score.
- Readability is evaluated over multiple sampled locations across the translated glyph/outline footprint. Selection uses both an overall/broad score and a lower-percentile/worst-region measure rather than average contrast alone.
- The target policy is approximately `4.5:1` effective contrast across most relevant sampled locations while avoiding materially weak local regions around `< 3:1` when a stronger candidate exists. These values define behavior goals, not a requirement to expose raw threshold controls to users.
- The exact internal contrast metric may use standard luminance/contrast primitives plus outline-aware separation, but tests assert selected behavior rather than a specific private formula.
- Adaptive Readable outline thickness is proportional to glyph scale. The expected normal range is roughly `0.10–0.14` and may escalate roughly to `0.16–0.20` for complex backgrounds. The implementation must cap thickness before glyph counters/strokes become visually clogged, especially for Thai text.
- Escalation order is fixed: normal safe Fill + Outline → thicker Outline → controlled Shadow/Halo → Background Plate where permitted.
- Controlled Shadow/Halo is a readability aid, not source decorative style. It appears only when ordinary outlined candidates fail the Readability Gate and must remain visually restrained.
- Automatic Background Plate is a last-resort safety mechanism restricted to Overlay Subtitle. It is not automatically added to Dialogue or Narration / Panel Caption.
- If Dialogue or Narration / Panel Caption still fails the Readability Gate after non-plate escalation, the system chooses the strongest available non-plate candidate, preserves explicit fallback/review provenance, and marks it for review rather than altering the panel with a new plate.
- SFX / Decorative may enter Adaptive Readable when source evidence is invalid, but validated decorative source effects remain source-faithful and are not replaced merely because Readable has stronger contrast.
- The fallback chain remains: own validated source style → bounded local re-analysis → validated same-category Nearby color profile → Adaptive Readable fallback.
- Auto retains Auto ownership when fallback occurs and exposes `Auto → Readable fallback` plus a reason. Readable ownership intentionally selects Adaptive Readable without claiming source fidelity. Manual remains user-owned.
- Manual style bypasses automatic adaptive mutation. Low-contrast warning may be recomputed for Manual, but fill, outline, thickness, opacity, gradient, source effects, and user-owned effects remain unchanged.
- Adaptive Readable must be recomputed after committed layout changes that materially change the translated glyph footprint, including move, resize, font-size change, or text reflow. Recalculation is deferred until the interaction commits rather than running every pointer frame.
- Saved state must preserve enough information to distinguish source-faithful Auto, Auto → Readable fallback, explicit Readable, Manual, escalation level, fallback reason, and review-required state without breaking older profiles that lack these fields.
- Workspace rendering and export rendering consume the same final resolved style semantics.
- No additional cloud/AI request is introduced solely for adaptive readability scoring, safe candidate selection, escalation, or layout-triggered recomputation.
- ADR 0006 governs source-faithful rendering after validation. ADR 0007 governs evidence-gated source admission and fallback ordering. The Adaptive Readable decision in this revision supersedes ADR 0007’s earlier fixed light-fill/dark-outline fallback detail while preserving its gating and ownership rules.

## Testing Decisions

Tests continue to assert externally observable behavior and reuse the three already-confirmed high-level seams. No new low-level test seam is required for Adaptive Readable because the new behavior fits inside the existing resolution and rendering contracts.

### Seam 1 — Source Style Recovery + Evidence Admission

Provide a source image region, with precise Glyph mask evidence when available, and observe the resulting Source text style profile, evidence/admission state, and fallback provenance.

Required behavior coverage includes:

- Valid plain black dialogue on a light balloon still resolves to black fill with explicit no-outline source state.
- Valid plain white text on a dark region still resolves to white fill with explicit no-outline source state.
- Valid colored fill, outline, and source decorative effects remain recoverable.
- Precise Glyph mask evidence excludes surrounding artwork.
- Text-removal mask data is never treated as authoritative Glyph mask evidence.
- A wide or loose region over complex artwork cannot promote surrounding artwork colors merely because those colors form a strong cluster.
- Confidence remains separate from evidence validity, including rejection of contaminated high-confidence candidates.
- A rejected source candidate exposes enough provenance for the downstream fallback policy to explain why Adaptive Readable may be needed.

Prior art: existing synthetic color-region tests, source-style regression fixtures, and color-matching scenario tests.

### Seam 2 — Style Resolution + Readability/Fallback Policy

Provide translated bubbles, validated/invalid source profiles, category metadata, Nearby candidates, Inpainted clean background evidence, translated layout/glyph-footprint information, and ownership state; observe the final resolved style, escalation level, fallback reason, and ownership.

Required behavior coverage includes:

- A validated readable source profile remains source-faithful and is not forced into Adaptive Readable.
- A validated no-outline source profile stays no-outline.
- Auto follows the fixed fallback order before entering Adaptive Readable.
- Explicit Readable ownership enters Adaptive Readable directly without claiming source fidelity.
- Adaptive Readable compares safe fill/outline pairs rather than assuming white fill.
- A white or near-white speech balloon selects a dark-fill readable candidate rather than white-on-white text.
- A dark background can select a light-fill/dark-outline candidate when that pair scores better.
- A mixed bright/dark background is evaluated across multiple samples, and a good average cannot hide a severely weak portion.
- Candidate acceptance reflects the approximately 4.5:1 broad target and avoids materially weak local regions around 3:1 when a stronger safe candidate is available.
- Readable output always has an outline.
- Simple backgrounds stop at normal outline; difficult backgrounds may escalate outline thickness.
- Shadow/halo appears only after ordinary outline candidates fail.
- Background plate is available only for Overlay Subtitle as the final automatic escalation.
- Dialogue and Narration / Panel Caption never gain an automatic background plate; unresolved cases are marked for review instead.
- Auto retains Auto ownership while exposing `Auto → Readable fallback` and reason.
- Manual remains unchanged regardless of adaptive-readability score or escalation opportunities.
- Legacy/partial profiles resolve safely with backward-compatible defaults.

Prior art: existing automatic style-resolution tests, nearby-style-fallback tests, and translation workflow tests.

### Seam 3 — Overlay/UI/Export Behavior

Provide translated bubbles and final resolved ownership/fallback/escalation state to the translation workspace and renderer; observe user-visible Canvas behavior, interaction-driven recomputation, persistence, and export.

Required behavior coverage includes:

- Valid source no-outline profiles omit stroke rendering.
- Adaptive Readable profiles always execute outline rendering.
- Normal and escalated outline ratios visibly scale with translated glyph size without clogging text.
- White speech-balloon fallback renders dark readable text rather than disappearing as white-on-white.
- Controlled shadow/halo is rendered only when the final resolved readable state includes that escalation.
- Overlay Subtitle background plate is rendered only when the final resolved state explicitly reaches the plate escalation.
- Dialogue and Narration / Panel Caption do not receive automatic plates.
- Auto, Readable, and Manual ownership/fallback state is distinguishable to the user.
- Auto → Readable fallback exposes a reason suitable for review.
- A committed move, resize, font-size change, or reflow recomputes Adaptive Readable for Auto/Readable after the interaction settles.
- Dragging does not cause continuous style flicker from per-frame recomputation.
- Manual style survives the same layout edits unchanged.
- Single-page and batch translation both render fallback safely without translation failure.
- Saved/reloaded state preserves ownership, fallback reason, escalation level, and review-required state sufficiently to reproduce the reviewed result.
- Export uses the same final resolved fill, outline, outline width, shadow/halo, and plate semantics as the workspace overlay.

Prior art: existing translation-overlay behavior tests, manual-style persistence tests, translation workflow tests, and export/render tests.

A good test asserts what style is admitted, what Adaptive Readable candidate/escalation is resolved, what ownership/fallback state is exposed, and what the user sees or exports. Tests should not lock the implementation to a specific sampling loop, exact internal percentile function, private helper name, or one particular contrast-metric implementation.

## Out of Scope

- Pixel-for-pixel copying of source glyph raster data onto translated glyphs.
- Character-by-character source color mapping to Thai or other translated glyphs.
- Exact source font-family reproduction when the font is unavailable or unidentified.
- A new cloud/AI request solely for adaptive readability, contrast scoring, style validation, or text category classification.
- Treating the Text-removal mask as precise Glyph mask evidence.
- A universal fixed white fallback or a universal fixed black fallback.
- Chromatic/random fallback color generation for readability; safe candidates remain conservative and predictable.
- Exposing raw contrast thresholds, percentile settings, outline escalation thresholds, or pixel-sampling internals as ordinary user-facing controls in this revision.
- Automatic background plates for Dialogue or Narration / Panel Caption.
- Mutating Manual style to satisfy automatic readability rules.
- Continuous per-frame Adaptive Readable recalculation while the user is dragging or resizing.
- Guaranteeing perfect readability over every possible artwork texture without allowing review-required state.
- Replacing the existing source-faithful pipeline with a separate unrelated styling architecture.

## Further Notes

The governing principle for this revision is:

**Source fidelity when validated source evidence is trustworthy; adaptive outlined readability when fallback is necessary.**

“Readable fallback” no longer means “white text with a dark outline.” White/dark is only one safe candidate. The final readable style is selected against the Inpainted clean background beneath the translated glyph footprint, and Readable behavior always includes an outline.

The source and fallback semantics remain intentionally asymmetric: a validated source can be no-outline because fidelity is the goal, while Adaptive Readable always has an outline because separation from unknown/complex artwork is the goal.

The confirmed testing strategy remains exactly three high-level seams: Source Style Recovery + Evidence Admission, Style Resolution + Readability/Fallback Policy, and Overlay/UI/Export Behavior. No additional test seam is introduced for the new adaptive scoring algorithm.

Canonical terms include Source text style profile, Source style evidence gate, Style confidence band, Text style category, Nearby color profile, Inpainted clean background, Readable fallback style / Adaptive Readable style, Manual style override, Source-faithful rendering, and translated glyph footprint.

The architectural history is captured by ADR 0006 for source-faithful rendering, ADR 0007 for gated source admission/fallback ordering, and ADR 0008 for Adaptive Readable fallback with mandatory outline. ADR 0008 supersedes the fixed light-fill/dark-outline fallback detail from ADR 0007 while preserving its gating, category, and ownership decisions.
