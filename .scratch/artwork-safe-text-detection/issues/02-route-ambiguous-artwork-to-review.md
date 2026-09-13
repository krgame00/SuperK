# 02: Route ambiguous artwork detections to text review

**What to build:** Character-like marks with insufficient text evidence become Region awaiting text confirmation rather than automatically removable text. Keep isolated glyphs, SFX, decorative lettering and outlined colored text supported, and expose ambiguous candidates in the workspace instead of silently dropping them.

**Blocked by:** 01 — Preserve Unconfirmed text candidates while processing confident text.

**Status:** completed

- [x] Raw model confidence remains distinguishable from values assigned to extracted or expanded masks; mask growth cannot serve as independent text evidence.
- [x] Sparse or ambiguous artwork evidence does not gain removal permission solely by passing a block-confidence boundary.
- [x] Uncertain detections remain inspectable, excluded from automatic removal and translation, while confidently supported text still processes.
- [x] Non-text curves and seams, real isolated glyphs, SFX, outlined colored text and text touching artwork are represented in positive/negative regression scenarios.
- [x] No blanket category or isolated-stroke rejection is introduced; genuinely ambiguous text can be held for review.
- [x] Report artwork preservation and legitimate-text recall separately against the pre-change baseline on the available annotated fixtures; document calibration choices without inventing an accuracy target.
- [x] Retain the controlled sparse-stroke confidence-boundary example as a diagnostic regression and verify resulting review/cleaning behavior at the public pipeline and workspace seams.
- [x] Distinguish synthetic contract validation from real-model results. Do not claim the supplied screenshot case was reproduced unless its original input or detector output has been reliably linked and replayed.

## Scope and verification

Use existing detector and eligibility facilities. Avoid a blind Boolean-condition replacement, a universal threshold increase, model retraining or new user-facing tuning controls. This ticket changes how evidence reaches the review flow established by ticket 01, not just an isolated detector helper.

## Comments

Breakdown and testing seams approved by the user on 2026-09-14.
