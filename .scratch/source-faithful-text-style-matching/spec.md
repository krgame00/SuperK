# Source-Faithful Manga Text Style Matching — Binary Fill + Source Outline Revision

**Triage:** `ready-for-agent`

## Problem Statement

SuperK should preserve source manga text styling when that styling can be recovered reliably, but its fallback behavior must remain consistently readable across white speech balloons, dark panels, bright skin/highlights, and mixed artwork.

Previous revisions solved two important failure classes: background/artwork colors being mistaken for source text colors, and fixed white fallback text disappearing on bright backgrounds. The current Adaptive Readable design improved safety by comparing multiple fill/outline pairs against the Inpainted clean background. Real usage still shows that allowing many possible fallback fill colors creates too much visual variation and too many ways for translated text to become muddy, inconsistent, or difficult to read.

The newly confirmed policy intentionally reduces fallback freedom. When a region enters Readable behavior, translated glyph fill is restricted to **pure white or pure black**. Source color is used primarily as an outline accent when that produces a readable result. This keeps the text body predictable while retaining some source identity through the outline.

The system therefore has three distinct ownership paths:

- **Source-faithful Auto:** preserve a validated Source text style profile, including its authored fill and outline presence, when the Source style evidence gate and Readability gate both pass.
- **Binary Fill Readable:** when Auto exhausts its safe source/nearby fallback chain, or when the user explicitly selects Readable, use only white or black fill plus an outline selected from source accent evidence and local readability.
- **Manual:** preserve exactly what the user selected. Automatic evidence or readability logic may warn but must not mutate Manual styling.

The desired result is predictable: validated source styling remains source-faithful, while Readable fallback becomes simple, high-contrast, and repeatable instead of trying to reproduce uncertain chromatic fills.

## Solution

Revise Readable behavior to use a **Binary Fill + Source Outline** policy while retaining the existing source-evidence, fallback-order, ownership, persistence, and export guarantees.

The system will:

1. Keep the original pre-clean image authoritative for Source text style profile recovery.
2. Keep the Source style evidence gate and automatic Readability gate as prerequisites for source-faithful Auto rendering.
3. Preserve validated source styling as source-faithful, including source fill, source outline when present, source opacity, and supported source effects.
4. Preserve validated source no-outline state. The mandatory-outline rule applies to Readable behavior, not to a validated source profile.
5. Keep the fallback chain: own validated source style → bounded local re-analysis → validated same-category Nearby color profile → Binary Fill Readable fallback.
6. Replace free-form Adaptive Readable fill selection with Binary Fill Readable: fallback fill may only be `#FFFFFF` or `#000000`.
7. Require an outline for every Binary Fill Readable result.
8. Derive a Source accent color from trustworthy detected source fill/outline evidence when available. The Source accent is primarily used to preserve thematic identity in the Readable outline rather than as a chromatic fill.
9. Classify the Source accent mainly by luminance/brightness rather than semantic color name.
10. For a light/bright Source accent, prefer white fill with a Source-accent outline, then strengthen/darken the outline while preserving hue when needed for separation.
11. For a dark/near-black Source accent, prefer black fill with a white/light high-contrast outline.
12. For ambiguous mid-tone Source accents, evaluate both binary fill directions through the Readability gate rather than assuming a semantic color family.
13. Treat those mappings as preferences, not permission to render unreadable text. If the preferred pair fails local readability, evaluate the alternate binary fill direction and safe outline variant while keeping fill strictly white or black.
14. Use the Inpainted clean background under the Translated glyph footprint plus a small margin as the readability surface; do not use the entire OCR box as the primary background sample.
15. Continue evaluating multiple locations across the footprint so a good average cannot hide a locally unreadable part of the text.
16. Continue targeting roughly `4.5:1` effective contrast across most relevant samples and avoiding materially weak local regions around `3:1` when a stronger Binary Fill candidate exists.
17. Permit Source-accent outline strengthening by changing lightness/value while preserving hue where practical. Do not require exact source RGB when that would make fallback unreadable.
18. Permit a safe neutral outline (white/light or dark/black) when the Source accent cannot provide sufficient separation, while keeping fill binary.
19. Keep outline width proportional to glyph size and reuse the existing readable outline escalation/capping rules so Thai counters and tone marks do not become clogged.
20. Keep controlled readability shadow/halo and Overlay Subtitle background plate as later escalation only after Binary Fill + Outline candidates fail; they are not source effects.
21. Keep automatic background plates restricted to Overlay Subtitle. Dialogue and Narration / Panel Caption use the strongest non-plate Binary Fill result and review-required state if still insufficient.
22. Simplify decorative fallback deliberately: when SFX / Decorative or other authored effects enter Binary Fill Readable, do not attempt to reproduce uncertain gradient/glow/shadow as source-faithful effects. Reduce the fallback to binary fill, readable outline, and only the safety escalation required for legibility.
23. Keep validated decorative Source text style profiles source-faithful when their evidence and readability pass; the simplification applies only after entering Readable behavior.
24. Keep Auto ownership as Auto when fallback occurs and expose `Auto → Readable fallback` plus a reason.
25. Keep Readable as an explicit user-selected ownership mode that enters Binary Fill Readable directly without pretending the result is recovered source styling.
26. Keep Manual authoritative. Automatic binary recoloring, outline selection, outline strengthening, readability escalation, and layout-triggered recomputation must not mutate a Manual profile.
27. Recompute Auto/Readable fallback after committed layout changes that materially change the Translated glyph footprint; do not recompute every pointer frame.
28. Preserve ownership, fallback reason, Source accent/provenance where needed, resolved binary fill/outline, escalation level, and review-required state across save/load.
29. Use the same final resolved style semantics in the translation workspace, single-page flow, batch flow, and export.
30. Introduce no additional cloud/AI request solely for Binary Fill classification, outline selection, or readability evaluation.

## User Stories

1. As a manga translator, I want validated source text to keep its authored fill color, so that trustworthy source styling remains faithful.
2. As a manga translator, I want validated source text to keep its authored outline color and width, so that real source borders remain recognizable.
3. As a manga translator, I want validated source text with no outline to remain no-outline, so that fallback safety rules do not rewrite trustworthy source styling.
4. As a manga translator, I want contaminated source colors rejected before rendering, so that background artwork cannot become translated text color.
5. As a manga translator, I want Auto to try its own validated source style before fallback, so that good source evidence is not discarded.
6. As a manga translator, I want one bounded local re-analysis before fallback, so that recoverable source styling gets another deterministic attempt.
7. As a manga translator, I want Nearby inheritance limited to validated same-category profiles, so that unrelated text roles cannot donate styling.
8. As a manga translator, I want Readable fallback to use only white or black fill, so that the body of translated text is visually predictable.
9. As a manga translator, I want Binary Fill Readable to always include an outline, so that fallback glyphs have a separation boundary from artwork.
10. As a manga translator, I want bright detected source colors to influence the outline rather than become low-contrast chromatic fill, so that source identity remains visible without sacrificing readability.
11. As a manga translator, I want dark detected source colors to produce a dark fill with a light outline when that is readable, so that dark source intent maps to a stable high-contrast form.
12. As a manga translator, I want source-color lightness measured numerically rather than inferred from color names, so that cyan, purple, orange, and other hues are classified consistently.
13. As a manga translator, I want mid-tone source colors treated as ambiguous, so that the system checks both binary directions rather than guessing from hue.
14. As a manga translator, I want a light Source accent outline darkened or strengthened when necessary, so that a pastel border does not disappear on a bright panel.
15. As a manga translator, I want outline hue preserved where practical during strengthening, so that the character/theme accent is still recognizable.
16. As a manga translator, I want a safe neutral outline used when the source accent cannot provide enough separation, so that readability wins in the fallback path.
17. As a manga translator, I want white speech-balloon fallback to avoid white-on-white text, so that dialogue remains immediately readable.
18. As a manga translator, I want dark panels to allow white Binary Fill when that is the stronger result, so that dark backgrounds do not force unreadable black text.
19. As a manga translator, I want the preferred Binary Fill mapping validated against the actual background, so that source brightness alone cannot authorize a bad pair.
20. As a manga translator, I want fallback background analysis under the laid-out translated glyphs, so that unrelated OCR-box margins do not influence the result.
21. As a manga translator, I want readability checked across multiple parts of the text, so that one weak section cannot be hidden by a strong average.
22. As a manga translator, I want the strongest readable white/black candidate selected on mixed artwork, so that the text remains consistent without per-character recoloring.
23. As a manga translator, I want readable outline width to scale with glyph size, so that small and large translated text receive proportional separation.
24. As a manga translator, I want outline escalation capped before Thai loops and tone marks become clogged, so that thicker safety strokes remain legible.
25. As a manga translator, I want shadow/halo used only after ordinary Binary Fill + Outline candidates fail, so that safety effects are not overused.
26. As a manga translator, I want Overlay Subtitle to be allowed a last-resort background plate, so that text over extreme artwork can still be recovered visibly.
27. As a manga translator, I want Dialogue to avoid automatic background plates, so that the system does not paint new boxes inside speech balloons.
28. As a manga translator, I want Narration / Panel Caption to avoid automatic background plates, so that panel composition is not altered unnecessarily.
29. As a manga translator, I want unresolved non-plate cases marked for review, so that I know where manual attention is still useful.
30. As a manga translator, I want decorative source text to remain decorative when its validated source profile is trustworthy, so that good source effects are not flattened.
31. As a manga translator, I want decorative fallback simplified to white/black fill plus readable outline, so that uncertain gradients and glows are not fabricated.
32. As a manga translator, I want Auto to remain selected when it falls back, so that ownership state remains truthful.
33. As a manga translator, I want Auto to show `Auto → Readable fallback`, so that I can distinguish source-faithful output from safety output.
34. As a manga translator, I want a concise fallback reason, so that I can tell whether the cause was contamination, weak evidence, low readability, or no valid nearby profile.
35. As a manga translator, I want an explicit Readable mode, so that I can intentionally choose the stable Binary Fill policy.
36. As a manga translator, I want explicit Readable mode to use the same Binary Fill policy as Auto fallback, so that there is one coherent safety model.
37. As a manga translator, I want Manual style to remain exactly mine, so that binary recoloring never silently overrides a deliberate choice.
38. As a manga translator, I want a low-contrast Manual warning without automatic mutation, so that I keep control while receiving useful feedback.
39. As a manga translator, I want moving or resizing Auto/Readable text to recompute after I finish the interaction, so that readability matches the new background.
40. As a manga translator, I want font-size and reflow changes to recompute Auto/Readable after layout settles, so that the new footprint is evaluated.
41. As a manga translator, I do not want style recomputation every drag frame, so that editing remains responsive and does not flicker.
42. As a manga translator, I want layout changes to leave Manual styling untouched, so that geometry edits do not change my chosen colors.
43. As a manga translator, I want source accent and fallback provenance persisted, so that reopening a project reproduces the reviewed Binary Fill result.
44. As a manga translator, I want legacy projects without Binary Fill metadata to load safely, so that this revision does not invalidate older work.
45. As a manga translator, I want re-translation to update wording without losing ownership/fallback state, so that visual corrections survive text changes.
46. As a manga translator, I want single-page and batch translation to use the same Binary Fill rules, so that output quality does not depend on workflow.
47. As a manga translator, I want style failure to remain non-fatal, so that one difficult region never stops a page or batch.
48. As a manga translator, I want workspace rendering and export to use the same final white/black fill and outline, so that exported pages match what I reviewed.
49. As a manga translator, I want white-background regression coverage, so that white fallback text cannot disappear again.
50. As a manga translator, I want dark-background regression coverage, so that black Binary Fill is not selected when it would disappear.
51. As a manga translator, I want pastel Source accent regression coverage, so that weak chromatic outlines are strengthened when necessary.
52. As a manga translator, I want dark Source accent regression coverage, so that the dark-source mapping remains predictable.
53. As a manga translator, I want mixed-background regression coverage, so that average-only scoring cannot return silently.
54. As a manga translator, I want validated source no-outline regression coverage, so that Binary Fill mandatory outline never leaks into source-faithful rendering.
55. As a manga translator, I want Manual regression coverage, so that automatic Binary Fill cannot mutate user-owned styling.
56. As a maintainer, I want Binary Fill behavior testable from resolved style output, so that internal luminance thresholds can evolve without brittle tests.
57. As a maintainer, I want Source accent strengthening tested by observable outline hue/readability behavior rather than a private color-conversion helper.
58. As a maintainer, I want Readability gate tests to prove the preferred mapping can be rejected, so that luminance classification is not mistaken for final admission.
59. As a maintainer, I want decorative fallback tests to prove source effects are removed only after entering Readable behavior, so that source and fallback semantics remain distinct.
60. As a maintainer, I want no extra cloud request for Binary Fill, so that this safety revision adds no API cost or quota pressure.

## Implementation Decisions

- Source recovery and Readable fallback remain separate contracts. The original pre-clean image supplies Source text style evidence; the Inpainted clean background supplies the local surface for fallback readability evaluation.
- Validated Source text style profiles remain source-faithful. Source fill, validated outline presence/absence, relative outline thickness, opacity, and supported source effects are preserved when both evidence and readability admission succeed.
- The previous universal automatic-outline policy is narrowed: a validated source profile may remain no-outline. Mandatory outline applies to Readable output and does not authorize rewriting admitted source styling.
- The fallback chain remains own validated source → bounded local re-analysis → validated same-category Nearby color profile → Readable fallback.
- Readable fallback is now Binary Fill + Source Outline. Readable fill is restricted to pure white or pure black; chromatic fallback fill is not allowed.
- A Source accent color is derived from trustworthy detected source styling when available. It is primarily an outline accent in Readable behavior, not a fallback fill color.
- Source accent classification is luminance-led. Bright/light accents prefer white fill with Source-accent outline; dark/near-black accents prefer black fill with white/light outline; ambiguous mid-tones are evaluated in both binary directions through the Readability gate.
- The preferred luminance mapping is only an initial candidate. Local background readability remains authoritative; a preferred candidate can be rejected.
- Source-accent outline strengthening may adjust lightness/value while preserving hue where practical. Exact source RGB is not required in Readable behavior when it would reduce legibility.
- A safe neutral high-contrast outline is permitted if the Source accent cannot provide sufficient separation. Fill remains binary regardless.
- Readability is evaluated against the Inpainted clean background beneath the Translated glyph footprint plus a small outline margin, using multiple samples and both broad and weak-region behavior.
- The existing approximate readability targets (~4.5:1 across most samples, avoiding materially weak ~3:1 regions when a stronger candidate exists) remain behavioral goals rather than user-facing controls.
- Readable outline width remains proportional to glyph scale and may escalate within the established safe ranges, subject to a cap that preserves Thai counters and tone marks.
- Controlled readability halo/shadow and Overlay Subtitle background plate remain later escalation stages. They are fallback safety effects and must stay distinct from validated source decorative effects.
- Automatic background plate remains restricted to Overlay Subtitle. Dialogue and Narration / Panel Caption fall back to the strongest non-plate Binary Fill candidate and review-required state when necessary.
- SFX / Decorative retains validated source effects when admitted. Once it enters Readable behavior, uncertain gradient/glow/shadow is intentionally simplified rather than guessed.
- Auto remains Auto when Binary Fill fallback occurs and exposes fallback provenance. Explicit Readable enters Binary Fill directly. Manual remains user-owned and bypasses automatic mutation.
- Auto/Readable recompute after committed layout changes that materially alter the Translated glyph footprint, not on every interaction frame. Manual is not adaptively rewritten.
- Saved state preserves enough information to reproduce ownership, fallback reason, resolved binary fill/outline, Source accent/provenance where relevant, escalation level, and review-required state while remaining backward-compatible.
- Workspace rendering and export consume the same final resolved style semantics.
- No additional cloud/AI request is introduced solely for Binary Fill classification, Source accent strengthening, or Readability gate evaluation.
- ADR 0006 continues to govern source-faithful rendering after validation. ADR 0007 continues to govern gated source admission/fallback order. ADR 0012 supersedes the Readable fill-selection details from ADR 0008, narrows ADR 0010's universal-outline rule, and absorbs the thematic chromatic-outline fallback intent from ADR 0011 into the Binary Fill Readable path.

## Testing Decisions

Tests continue to assert externally observable behavior through the same three confirmed high-level seams. No additional seam is required.

### Seam 1 — Source Style Recovery + Evidence Admission

Provide a source image region and available glyph evidence; observe the recovered Source text style profile, evidence/admission state, and provenance.

Required behavior coverage includes:

- Valid source black/dark dialogue can recover its authored fill and outline state.
- Valid source white/light text can recover its authored fill and outline state.
- Valid source chromatic fill/outline and supported decorative effects remain recoverable.
- Validated source no-outline remains representable and is not converted into a Binary Fill fallback profile.
- Background/artwork contamination cannot be admitted solely because it forms a high-confidence cluster.
- Text-removal masks remain non-authoritative for glyph-style admission.
- Rejected/uncertain source style exposes enough provenance for downstream Readable fallback.

Prior art: existing source-style, color-sampling, and evidence-gating regression tests.

### Seam 2 — Style Resolution + Readability/Fallback Policy

Provide source profile/admission state, Text style category, Nearby candidates, Inpainted clean background evidence, Translated glyph footprint, and ownership; observe final resolved style, source/fallback provenance, and escalation state.

Required behavior coverage includes:

- Validated source-faithful profiles bypass Binary Fill and keep authored fill/outline semantics.
- Own-source → re-analysis → validated same-category nearby → Binary Fill fallback order remains observable.
- Binary Fill fallback emits only white or black fill.
- Every Binary Fill result has an outline.
- Light/bright Source accent prefers white fill + Source-accent outline before background validation.
- Dark/near-black Source accent prefers black fill + white/light outline before background validation.
- Ambiguous mid-tone Source accent is evaluated through both binary directions rather than assigned by hue name.
- A preferred mapping that is unreadable on the local background is rejected for the alternate binary candidate.
- Pastel/light Source accent outline can be strengthened while retaining recognizable hue where practical.
- Safe neutral outline can replace an unusable Source accent without introducing chromatic fill.
- White/near-white speech balloons do not render white-on-white fallback.
- Dark panels do not render black-on-dark fallback when a white binary candidate is stronger.
- Mixed backgrounds use multiple samples so strong averages cannot hide weak local regions.
- Readable output may escalate outline/halo/plate only according to the established category-safe order.
- Source decorative effects remain only on admitted source profiles; Readable decorative fallback is simplified.
- Auto retains Auto ownership with `Auto → Readable fallback`; explicit Readable uses the same Binary Fill policy; Manual remains unchanged.

Prior art: existing automatic style-resolution, nearby fallback, thematic subtitle, universal-outline, and adaptive-readability tests. Tests that encode older policy must be revised to the new externally observable contract rather than preserved mechanically.

### Seam 3 — Overlay/UI/Export Behavior

Provide resolved source/Readable/Manual styles to workspace rendering, persistence, and export; observe user-visible output and ownership behavior.

Required behavior coverage includes:

- Validated source no-outline can render without stroke.
- Binary Fill Readable always renders an outline.
- Readable white/black fill and outline match the resolved policy on screen and in export.
- Strengthened Source-accent outline remains visually recognizable and consistent across workspace/export.
- Controlled halo/plate appears only when present in the final resolved fallback state.
- Auto fallback state/reason remains visible and persists across save/load.
- Explicit Readable, Auto, and Manual remain distinguishable.
- Manual survives re-render, re-translation, layout changes, persistence, and export unchanged.
- Committed layout changes recompute Auto/Readable without per-frame style flicker.
- Single-page and batch workflows use the same Binary Fill policy and remain non-fatal on style failure.

Prior art: existing translation-overlay, persistence, workflow, and export/render tests.

A good test asserts admitted source behavior, final binary fill/outline behavior, ownership/provenance, and visible/exported result. Tests should not lock to one private luminance threshold, color-space helper, sampling loop, or implementation-specific function call order.

## Out of Scope

- Converting validated Source text style profiles to black/white merely because Binary Fill exists.
- Chromatic Readable fill colors; Readable fill is binary by design.
- Exact pixel-for-pixel reproduction of source glyph raster data.
- Character-by-character fallback color changes.
- Exact source font-family reproduction when unavailable.
- A new cloud/AI request solely for Binary Fill, accent classification, or readability evaluation.
- Treating Text-removal mask data as precise Glyph mask evidence.
- Preserving uncertain gradient/glow/shadow in Readable fallback.
- Automatic background plates for Dialogue or Narration / Panel Caption.
- Mutating Manual style to satisfy Binary Fill or readability rules.
- Exposing raw luminance thresholds, contrast thresholds, or outline-strengthening internals as ordinary user settings in this revision.
- Continuous per-frame fallback recomputation while dragging/resizing.
- Guaranteeing perfect readability over every possible artwork texture without review-required state.

## Further Notes

The governing principle for this revision is:

**Preserve trustworthy source styling; when Readable fallback is necessary, keep the glyph body black or white and use the outline to carry safe source identity.**

Binary Fill is intentionally not a source-style recovery algorithm. It is a safety policy for Readable behavior. A validated Source text style profile can still be chromatic, decorative, or no-outline because fidelity is the goal of that path.

The confirmed test strategy remains exactly three high-level seams: Source Style Recovery + Evidence Admission, Style Resolution + Readability/Fallback Policy, and Overlay/UI/Export Behavior.

Canonical terms for this revision include Source text style profile, Source style evidence gate, Source accent color, Binary Fill + Source Outline, Readable fallback style, Readability gate, Translated glyph footprint, Nearby color profile, Manual style override, and Source-faithful rendering.
