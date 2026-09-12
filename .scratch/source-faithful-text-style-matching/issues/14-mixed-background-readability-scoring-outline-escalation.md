# 14: Mixed-Background Readability Scoring & Outline Escalation

**What to build:** Make Adaptive Readable robust when one translated text region crosses both bright and dark artwork. Readability must be judged across multiple locations beneath the Translated glyph footprint, not from a single average, and the system must escalate outline strength only as much as necessary to keep the text legible without clogging Thai glyph shapes.

**Blocked by:** 13: Adaptive Readable on Bright & White Backgrounds.

**Status:** closed

- [x] Readability scoring samples multiple locations across the Translated glyph footprint and does not rely on whole-box average brightness alone.
- [x] Candidate evaluation considers both broad/overall readability and a weak-region or lower-percentile measure so a good average cannot hide a locally unreadable section.
- [x] The behavioral target is approximately 4.5:1 effective contrast across most sampled areas when practical.
- [x] Materially weak local regions around 3:1 or lower cause the resolver to prefer a stronger safe candidate when one is available.
- [x] Mixed bright/dark backgrounds can choose one stable Fill + Outline pair that remains readable across both tones instead of changing color per character.
- [x] Readable outline thickness scales proportionally with glyph/text size rather than using one fixed pixel width.
- [x] Ordinary readable cases can resolve around a normal outline ratio of roughly 0.10–0.14.
- [x] Difficult backgrounds can escalate outline thickness roughly toward 0.16–0.20 when needed.
- [x] Outline escalation is capped or constrained so Thai glyph counters and internal shapes do not become visually clogged.
- [x] Stronger outline is selected only when the normal outlined candidate fails the Readability gate; simple backgrounds are not over-stroked.
- [x] The final resolved outline ratio/provenance remains available to workspace rendering, persistence, and export.
- [x] Tests assert visible/resolved readability outcomes rather than a specific internal percentile function, sampling density, or contrast implementation.
