# 08: Evidence-Gated Source Style on Complex Backgrounds

**What to build:** Prevent surrounding artwork from being accepted as source text style when OCR regions include complex background content. Source style may only be admitted when the visible text itself provides trustworthy local evidence. Wide or loose regions must use tightened text-focused evidence, center-weighted support, and border/background rejection so carpet, shadows, colored lines, character artwork, or other panel colors are not rendered as translated text even when those colors form a strong cluster.

**Blocked by:** 01: Plain Dialogue Source Fidelity; 02: Source-Derived Outline Fidelity; 03: Confidence Bands & Non-Fatal Style Recovery. These predecessors are already complete.

**Status:** closed

- [x] A wide or loose text region containing surrounding artwork does not accept a background/artwork color as the Source text style profile solely because that color dominates the crop.
- [x] When precise Glyph mask evidence is unavailable, automatic recovery uses text-local evidence that favors a tightened region and central text support while reducing or rejecting border-connected evidence.
- [x] Source pixels connected primarily to the outer region boundary are treated as likely background/artwork rather than trusted glyph evidence unless independent text-local evidence supports them.
- [x] A high numeric confidence score alone cannot bypass the Source style evidence gate.
- [x] A candidate style that resembles the local background more strongly than the visible glyph evidence is rejected rather than presented as source-faithful style.
- [x] Rejection is structural and evidence-based; the system does not blacklist specific colors such as brown, orange, grey, or blue.
- [x] When the candidate is rejected, the bubble retains explicit fallback provenance and a machine-readable rejection reason such as background contamination or insufficient source evidence.
- [x] Valid plain dialogue and genuinely colored/outlined text continue to pass the evidence gate when their glyph evidence is trustworthy.
- [x] Text-removal masks remain non-authoritative for source-style admission and are never substituted for Glyph mask evidence.
- [x] Source-style recovery failure remains non-fatal to single-page and batch translation.
- [x] Regression coverage includes the reported failure shape: a wide text region over a multicolor floor/background with strong colored lines around the text must not resolve those outside colors as the translated text fill.
- [x] Tests exercise the confirmed Source Style Recovery + Evidence Admission seam and assert observable profile/fallback outcomes rather than private clustering implementation details.
