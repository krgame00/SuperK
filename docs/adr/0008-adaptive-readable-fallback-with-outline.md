# 0008. Adaptive Readable Fallback with Mandatory Outline

Date: 2026-09-13

## Status

Accepted

## Context

ADR 0007 introduced evidence-gated source fidelity and a safe Readable fallback when automatic source styling is invalid or unreadable. The initial fallback detail favored light/white fill with a dark outline for text placed over artwork.

A subsequent regression showed that a fixed light fallback is not universally readable. White fallback text can disappear on white or near-white speech balloons, bright skin, highlights, glow, or other locally bright regions. A single OCR box may also span both bright and dark artwork, so average crop color is not a reliable basis for a readability decision.

The fallback must therefore be selected against the actual cleaned background beneath the translated text layout, not from a universal preset.

## Decision

Readable behavior will use an Adaptive Readable style selected against the Inpainted clean background under the translated glyph footprint plus a small margin.

The system evaluates multiple conservative fill/outline pairs, including light-fill/dark-outline and dark-fill/light-outline candidates. Readable output always includes an outline. This mandatory-outline rule applies only to Readable behavior and Auto → Readable fallback; a validated source-faithful profile may still render with no outline when that matches the source.

Readability selection considers multiple locations across the translated glyph footprint and uses both broad/overall readability and a lower-percentile or weak-region measure. The behavioral target is approximately 4.5:1 effective contrast across most sampled areas while avoiding materially weak local regions around 3:1 when a stronger safe candidate exists.

White or near-white speech balloons bias candidate selection toward dark fill. Outline width scales with glyph size, normally around 0.10–0.14 of the text scale and escalating roughly to 0.16–0.20 when needed, subject to a visual cap that prevents Thai glyphs from becoming clogged.

Escalation order is fixed: normal fill + outline, thicker outline, controlled shadow/halo, then an optional background plate where permitted. Shadow/halo is a readability aid rather than a recovered decorative source effect and is only introduced after ordinary outlined candidates fail.

Automatic background plates are restricted to Overlay Subtitle as a last-resort escalation. Dialogue and Narration / Panel Caption do not gain automatic plates; unresolved cases use the strongest non-plate candidate and are marked for review.

Auto retains Auto ownership when it falls back and exposes Auto → Readable fallback plus a reason. Explicit Readable mode uses the same adaptive selection intentionally. Manual style remains fully user-owned and is never rewritten by adaptive readability logic, though a non-mutating low-contrast warning may be shown.

Adaptive Readable is recalculated after committed layout changes that materially change the translated glyph footprint, such as move, resize, font-size change, or text reflow. Recalculation does not run on every pointer frame during dragging, and Manual style is not recomputed.

## Consequences

- ADR 0007 remains authoritative for source-evidence gating, fallback ordering, category-safe nearby inheritance, and Manual ownership, but its fixed light-fill/dark-outline fallback detail is superseded by this ADR.
- Readable fallback is background-aware and can choose dark text on bright backgrounds instead of assuming white text is safest.
- Source-faithful no-outline behavior remains intact because mandatory outline is limited to the Readable path.
- Rendering and persistence must distinguish source decorative shadow/glow from readability halo/shadow.
- Workspace and export must consume the same final Adaptive Readable escalation state.
- Layout changes can invalidate a previous readable decision, so Auto/Readable styles require bounded recomputation after interaction commit.
- No additional cloud or AI request is introduced solely for readability scoring or candidate selection.
