# 0007. Gate Source Fidelity Before Readable Fallback

Date: 2026-09-12

## Status

Accepted — Readable fallback styling amended by ADR 0008

## Context

ADR 0006 established source-faithful rendering so high-confidence source styles would not be normalized merely for readability. A regression showed that confidence alone is not sufficient evidence: when an OCR region includes surrounding artwork, floor texture, shadows, or other non-glyph pixels, the style sampler can assign high confidence to a background color and render translated text that is difficult to read.

The system therefore needs to distinguish confidence in a recovered cluster from evidence that the cluster actually belongs to the source glyph. It also needs a safe policy for text drawn directly over complex artwork, especially Overlay Subtitles.

## Decision

Automatic Source text style profiles are eligible for source-faithful rendering only after they pass both a Source style evidence gate and a readability validation against the local background. High confidence remains useful, but it does not bypass either gate.

When precise Glyph mask evidence is unavailable, automatic recovery must reduce contamination risk by concentrating on text-local evidence rather than accepting the raw OCR box as authoritative. Structural background evidence, border-dominant color, and insufficient separation from the local background may invalidate a source-style candidate.

The automatic fallback order is: the region's own validated source style, bounded local re-analysis, a validated Nearby color profile from the same Text style category, then a category-appropriate Readable fallback style. Overlay Subtitle is a distinct category from Narration / Panel Caption and receives a legible light-fill/dark-outline fallback when source evidence cannot be trusted.

Manual style overrides remain authoritative even when they would fail the automatic readability gate. The application may warn about poor contrast but must not silently rewrite a Manual style override. When Auto falls back for safety, the UI remains in Auto and exposes that a Readable fallback was selected and why.

## Consequences

- ADR 0006 remains valid for validated source evidence, but its rule that high-confidence source style takes precedence is narrowed: confidence alone no longer authorizes source-faithful rendering.
- Source-style recovery must expose enough evidence or provenance for automatic admission and fallback decisions to be explainable and testable.
- Text style categories are at minimum Dialogue, Narration / Panel Caption, SFX / Decorative, and Overlay Subtitle.
- Nearby inheritance requires a compatible category and a validated source profile; spatial proximity alone is insufficient.
- Automatic output may intentionally differ from a low-contrast or contaminated candidate in order to remain readable, while Manual style remains user-owned.
- Workspace rendering and export must use the same final resolved style and fallback state so the reviewed result matches the exported result.
