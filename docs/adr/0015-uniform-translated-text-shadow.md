# 0015. Uniform Translated Text Shadow

Date: 2026-09-17

## Status

Accepted — Shared Understanding confirmed on 2026-09-17. This ADR supersedes the per-region automatic shadow/glow rendering and readability-halo escalation details in ADR 0008 and ADR 0012; their fill, outline, evidence, and readability-gate decisions otherwise remain in force.

## Context

Real manga pages showed visually inconsistent translated text: one bubble could receive a detected source drop shadow or readability halo while another similar bubble received none. This made the result look unstable even when fill and source-colored outline matching were correct. The goal is to make automatically rendered translated text visually consistent across Workspace Preview, Export, and Chrome Extension while retaining source color identity in the outline and preserving manual user control.

## Decision

1. **Automatic translated text uses one uniform shadow treatment.** Auto, Auto → Readable fallback, explicit Readable, and admitted Source-faithful translated rendering all receive the same neutral dark drop shadow. This also applies to ordinary dialogue on clean or white speech balloons; background simplicity does not remove the shadow.

2. **The standard shadow is proportional to rendered text size.** The initial standard is `#1e1e1e`, opacity `0.80`, blur ratio `0.15`, offset-X ratio `0.08`, and offset-Y ratio `0.08`. Ratios scale with rendered font size so small and large text have the same perceived treatment.

3. **Detected source shadow and glow remain evidence, not automatic rendering authority.** Color/style sampling may continue to detect and retain source `shadow` and `glow` metadata for diagnostics, future features, or explicit user workflows, but Auto rendering does not reproduce those per-region effects.

4. **Per-region readability halo is removed from automatic rendering.** Readability must not make one bubble look more shadowed than another. The automatic escalation order becomes: normal readable fill + outline, stronger/thicker outline when needed, the unchanged Uniform translated text shadow, Overlay Subtitle-only background plate where permitted, then review-required state. The shadow itself is never strengthened for only one region.

5. **Outline and shadow have separate responsibilities.** Source-colored outline carries source visual identity; the uniform neutral shadow provides stable separation from artwork. If a dark source outline makes the result visually heavy, the system may adjust outline thickness/readability treatment rather than changing the standard shadow.

6. **Manual ownership remains authoritative.** Manual controls expose a minimal shadow choice: `Standard` or `Off`. Changing other manual properties such as fill, outline color, or outline thickness does not implicitly disable the standard shadow. A user-selected `Off` remains off until the region returns to automatic behavior or the user re-enables Standard.

7. **Legacy project metadata is preserved.** Existing saved `shadow`, `glow`, or readability-halo metadata is not destructively removed. When such a region is Auto/Readable, rendering follows this ADR immediately; the retained legacy metadata does not override the uniform automatic shadow.

8. **No global shadow tuning is introduced in this change.** The standard values remain fixed for now. A future global preset or slider may be evaluated only after real-world use shows a need.

9. **All rendering surfaces must match.** Workspace Preview, exported images/documents, Chrome Extension Server Mode, and Chrome Extension Direct Mode must consume equivalent shadow semantics so the user does not see one style while editing and another after export or in the reading overlay.

## Consequences

- Automatically rendered translated text no longer gains or loses a drop shadow merely because source-effect sampling differs between bubbles.
- Source shadow/glow detection can remain available without destabilizing visual output.
- Plain speech-balloon dialogue receives the same proportional shadow as artwork-overlay text, intentionally favoring consistency over exact source-effect fidelity.
- Readability differences are handled through fill/outline/background escalation rather than bubble-specific shadow intensity.
- Existing saved projects can adopt the new rendering behavior without deleting historical style evidence.
- Manual users retain a simple explicit escape hatch without introducing a large custom-shadow UI or global tuning surface.
