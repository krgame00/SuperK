# 03: Confidence Bands & Non-Fatal Style Recovery

**What to build:** Make source-style confidence drive deterministic user-visible behavior. High-confidence styles render directly, medium-confidence styles receive one bounded local refinement attempt, and low-confidence or failed recovery uses a safe global fallback while keeping translation successful and preserving fallback provenance for later review.

**Blocked by:** 01: Plain Dialogue Source Fidelity.

**Status:** resolved

- [x] Source style confidence uses the agreed behavioral bands: high at `>= 0.80`, medium at `0.60–0.79`, and low below `0.60`.
- [x] High-confidence profiles are eligible for direct source-faithful rendering without automatic readability correction.
- [x] Medium-confidence profiles perform a bounded local re-analysis/refinement pass before fallback and do not create an additional cloud request.
- [x] Low-confidence profiles use the controlled global fallback instead of rendering a weak source-color guess.
- [x] A bubble that falls back retains explicit fallback provenance so it can be identified and reviewed later.
- [x] Style-recovery errors do not fail an otherwise successful single-page translation.
- [x] Style-recovery errors do not abort an otherwise successful batch translation or invalidate already translated pages.
- [x] Regression coverage verifies confidence-band outcomes through the approved source-recovery and resolution seams.

## Answer

Implemented confidence-band behavior and non-fatal recovery. Source profiles now expose high/medium/low confidence metadata, medium-confidence recovery performs one bounded deterministic refinement based on local evidence, unresolved medium/low profiles retain explicit fallback provenance, and resolution refuses to render weak automatic guesses. Single-page and batch hook regressions confirm that source-style sampling failures are logged but do not fail translation or discard translated bubbles.
