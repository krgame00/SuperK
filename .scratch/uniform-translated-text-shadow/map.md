# Uniform Translated Text Shadow — Map

## Status

- Shared Understanding: confirmed.
- Testing Seams: confirmed.
- Specification: `spec.md` (`ready-for-agent`).
- Governing decision: ADR 0015 — Uniform Translated Text Shadow (`Accepted`).
- Ticket breakdown: approved and published.

## Dependency Graph

`01 → (02 + 03 + 04) → 05`

## Tickets

1. **01 — Uniform Shadow Automatic Rendering Baseline** — no blockers; establishes the automatic Standard Shadow contract across Auto, Readable, Source-faithful, and plain speech-balloon text while retaining source effect evidence.
2. **02 — Manual Shadow Standard / Off** — blocked by 01; adds explicit Manual shadow ownership with persistent Standard/Off behavior.
3. **03 — Legacy Project & Export Parity** — blocked by 01; preserves legacy effect metadata while making Workspace and Export follow the new automatic shadow semantics.
4. **04 — Chrome Extension Uniform Shadow Parity** — blocked by 01; brings Server/Direct reading overlays and restored caches into parity with Web rendering.
5. **05 — Cross-Surface Regression & Release Gate** — blocked by 02, 03, and 04; verifies both confirmed test seams, TypeScript, focused suites, and full regression.

## Confirmed Test Seams

1. **Translation Overlay → Resolved Style → Export** is the primary acceptance seam for automatic rendering, Manual ownership, legacy behavior, persistence, and export parity.
2. **Chrome Extension TRANSLATION_SUCCESS overlay** is the independent acceptance seam for reading-overlay parity because the extension owns a separate renderer.

Focused source-effect sampler tests remain diagnostic coverage only: they prove detected shadow/glow evidence can still be retained, not that those effects should control automatic final rendering.

## Implementation Constraints

- Standard Shadow: `#1e1e1e`, opacity `0.80`, blur ratio `0.15`, offset-X ratio `0.08`, offset-Y ratio `0.08`.
- Ratios scale with rendered font size.
- Source-colored outline remains separate from neutral shadow.
- Automatic per-region source shadow/glow and readability halo do not control final shadow rendering.
- Manual shadow control is limited to `Standard` / `Off` in this feature.
- No global shadow tuning is added.
- Legacy effect metadata is preserved rather than destructively migrated.
- Preserve unrelated dirty repository work; implementation must use narrow edits and regression verification.
