# Uniform Translated Text Shadow

**Triage:** `ready-for-agent`

## Problem Statement

SuperK currently renders translated manga text with inconsistent shadow treatment. One translated region may inherit a detected source drop shadow, another may receive a readability halo, and another may receive no shadow at all. The result looks unstable even when fill and Source-colored outline matching are otherwise correct.

The user wants automatically rendered translated text to have one predictable shadow treatment across the translation workspace, export output, and Chrome Extension. The shadow must not vary merely because a particular bubble happened to produce different source-effect evidence or readability escalation. Source shadow/glow detection may still be retained as evidence, but it must not override the automatic rendering policy.

The confirmed design therefore separates responsibilities: Source-colored outline carries source visual identity, while a neutral Uniform translated text shadow provides consistent separation from artwork. Manual users retain an explicit way to disable the standard shadow without having other style edits unexpectedly remove it.

## Solution

Introduce a single **Uniform translated text shadow** policy for all automatically rendered translated text.

Auto, Auto → Readable fallback, explicit Readable, and admitted Source-faithful rendering all use the same neutral proportional drop shadow. The initial standard is `#1e1e1e`, opacity `0.80`, blur ratio `0.15`, offset-X ratio `0.08`, and offset-Y ratio `0.08`, scaled with rendered font size so small and large glyphs receive the same perceived treatment.

Detected source `shadow` and `glow` remain available as Source style evidence, diagnostics, and possible future/manual data, but automatic rendering does not reproduce those per-region effects. Per-region readability halo is removed from the automatic path. When readability is weak, the system strengthens fill/outline treatment first, keeps the standard shadow unchanged, permits a background plate only for Overlay Subtitle where already allowed, and otherwise marks the region for review.

Manual styling gains one minimal shadow control: `Standard` or `Off`. Changing fill, outline color, outline thickness, font, or text content does not implicitly disable Standard. Existing saved source-effect metadata is preserved rather than destructively migrated, but Auto/Readable rendering of legacy projects follows the new uniform-shadow rule immediately.

Workspace Preview, export rendering, Chrome Extension Server Mode, and Chrome Extension Direct Mode must present equivalent shadow semantics.

## User Stories

1. As a manga translator, I want all automatically rendered translated text to use the same shadow treatment, so that a page looks visually stable.
2. As a manga translator, I want ordinary dialogue inside a white speech balloon to use the same standard shadow policy as other Auto text, so that shadow presence does not depend on background simplicity.
3. As a manga translator, I want Source-faithful Auto text to use the standard shadow rather than a separately detected source shadow, so that automatic output stays consistent.
4. As a manga translator, I want explicit Readable mode to use the same standard shadow as Auto fallback, so that both safety paths look coherent.
5. As a manga translator, I want the shadow to scale with font size, so that small and large translated text look proportionally similar.
6. As a manga translator, I want the standard shadow color and strength to remain neutral, so that it does not compete with the Source-colored outline.
7. As a manga translator, I want Source-colored outline to remain responsible for source visual identity, so that standardizing the shadow does not flatten thematic colors.
8. As a manga translator, I want the shadow to remain unchanged when the system adjusts outline thickness for readability, so that one difficult bubble does not suddenly look more shadowed than another.
9. As a manga translator, I want the system to avoid adding a per-bubble readability halo, so that local readability logic cannot make one region visually heavier than another.
10. As a manga translator, I want difficult readability cases to escalate through fill/outline treatment before other background aids, so that shadow intensity remains stable.
11. As a manga translator, I want Overlay Subtitle to retain its permitted background-plate fallback, so that extreme artwork remains recoverable without changing shadow intensity.
12. As a manga translator, I want Dialogue to remain plate-free unless the user manually chooses otherwise, so that the new shadow policy does not introduce new boxes into speech balloons.
13. As a manga translator, I want Narration / Panel Caption to remain plate-free automatically, so that panel composition is not altered unnecessarily.
14. As a manga translator, I want unresolved non-plate cases marked for review, so that visual safety does not silently change the shadow contract.
15. As a manga translator, I want source shadow detection to remain available as evidence, so that useful source information is not lost.
16. As a manga translator, I want source glow detection to remain available as evidence, so that future or manual workflows can still inspect it.
17. As a manga translator, I do not want detected source shadow/glow automatically rendered in Auto mode, so that per-region decorative effects cannot destabilize the page.
18. As a manga translator, I want legacy projects with saved shadow/glow metadata to open without data loss, so that historical style evidence remains intact.
19. As a manga translator, I want legacy Auto/Readable regions to immediately display using the new standard shadow, so that old projects benefit from the consistency fix.
20. As a manga translator, I want a Manual `Off` choice for shadow, so that I can intentionally remove the standard shadow from a specific region.
21. As a manga translator, I want a Manual `Standard` choice, so that I can return a manually styled region to the normal shadow treatment without changing its other style properties.
22. As a manga translator, I want changing fill color manually to leave shadow state alone, so that unrelated edits do not cause hidden side effects.
23. As a manga translator, I want changing outline color manually to leave shadow state alone, so that color correction does not unexpectedly remove the shadow.
24. As a manga translator, I want changing outline thickness manually to leave shadow state alone, so that readability tuning remains independent from shadow ownership.
25. As a manga translator, I want moving, resizing, or editing text to preserve my Manual shadow choice, so that interaction does not reset it.
26. As a manga translator, I want reopening a saved project to preserve Manual `Standard` or `Off`, so that the result matches what I reviewed.
27. As a manga translator, I want Workspace Preview and exported output to use the same final shadow semantics, so that export matches what I edited.
28. As a manga reader using the Chrome Extension, I want Server Mode overlays to use the same standard shadow as the main workspace, so that rendering does not drift across surfaces.
29. As a manga reader using the Chrome Extension, I want Direct Mode overlays to use the same standard shadow semantics, so that changing translation transport does not change typography.
30. As a manga translator, I want Chrome Extension outline rendering to remain separate from the drop shadow, so that the Source-colored border and neutral shadow do not get conflated.
31. As a maintainer, I want the uniform shadow represented by one shared behavioral contract, so that new rendering surfaces do not invent their own values.
32. As a maintainer, I want source-effect sampling tests to continue proving that shadow/glow evidence can be detected, so that this change does not accidentally delete source-analysis capability.
33. As a maintainer, I want acceptance tests to assert final rendered shadow behavior rather than private helper implementation, so that internal style resolution can evolve safely.
34. As a maintainer, I want legacy metadata preservation covered by regression tests, so that migration does not silently erase source effects.
35. As a maintainer, I want Manual `Off` persistence covered by regression tests, so that automatic resolution never re-enables a user-disabled shadow.
36. As a maintainer, I want plain speech-balloon regression coverage, so that an optimization does not later reintroduce “no shadow on simple backgrounds”.
37. As a maintainer, I want no global shadow slider introduced in this change, so that the consistency fix lands before adding another configuration dimension.
38. As a maintainer, I want no custom per-region shadow editor introduced in this change, so that Manual control remains intentionally minimal.
39. As a maintainer, I want export parity covered through the same resolved style path used by the workspace, so that duplicated style logic is not required for the test.
40. As a maintainer, I want extension parity covered at the actual overlay boundary, so that DOM/CSS drift is caught even if the web renderer remains correct.

## Implementation Decisions

- ADR 0015 is authoritative for shadow/glow/halo behavior. Existing fill, Source accent, outline, evidence-gate, ownership, and readability decisions from prior ADRs remain in force unless explicitly superseded by ADR 0015.
- Automatic translated rendering has one standard drop shadow across Auto, Auto → Readable fallback, explicit Readable, and admitted Source-faithful output.
- The standard shadow values are fixed for this change: neutral dark `#1e1e1e`, opacity `0.80`, blur ratio `0.15`, offset-X ratio `0.08`, offset-Y ratio `0.08`.
- Shadow geometry is proportional to rendered text size rather than fixed pixels.
- Source `shadow` and `glow` remain Source style evidence. They may stay serialized and available to diagnostics/future features, but they are not automatic rendering authority.
- Automatic readability no longer introduces a per-region halo or stronger local shadow. If additional readability is needed, the system may strengthen the outline within existing safe limits, use the already permitted Overlay Subtitle background plate, or mark the region review-required.
- Source-colored outline and Uniform translated text shadow are separate concerns. Outline carries source identity; shadow provides neutral separation.
- If a dark Source-colored outline makes a glyph look heavy, adjust outline thickness/readability treatment rather than changing the standard shadow for that region.
- Manual ownership exposes only two shadow states for this feature: `Standard` and `Off`.
- Editing other Manual style properties does not alter the Manual shadow state.
- Returning a region from Manual to automatic behavior restores the standard automatic shadow semantics.
- Existing project data containing detected `shadow`, `glow`, or readability-halo metadata is preserved. No destructive migration is required.
- Legacy Auto/Readable rendering ignores retained per-region source-effect metadata for final automatic shadow selection.
- Workspace Preview and export must consume the same final shadow semantics.
- Chrome Extension Server Mode and Direct Mode must render equivalent shadow semantics and keep outline rendering separate from the drop shadow.
- No global shadow preset, slider, or arbitrary custom shadow editor is introduced in this change.
- The change must preserve current Source accent confidence policy and existing Source-colored outline behavior.
- The repository contains unrelated dirty work. Implementation must use narrow edits and must not reset, clean, or broadly rewrite unrelated changes.

## Testing Decisions

Good tests assert externally observable behavior: the final resolved/rendered shadow, whether a user-visible Manual choice persists, whether legacy metadata survives, and whether different rendering surfaces match. Tests should not depend on private helper names, internal branch order, or exact storage layout unless those details are themselves part of the public contract.

Two confirmed acceptance seams will be used:

1. **Primary seam — Translation Overlay → Resolved Style → Export**
   - Use the existing translation overlay/workspace harness as the primary acceptance seam.
   - Exercise Auto, Readable, Source-faithful, Manual `Standard`, Manual `Off`, plain speech-balloon dialogue, difficult-readability cases, legacy saved metadata, and export parity.
   - Assert that all automatic ownership modes receive equivalent standard shadow semantics; per-region source shadow/glow and readability halo do not alter the final automatic shadow.
   - Assert that Manual `Off` remains off across style edits and serialization, while Manual `Standard` retains the standard shadow.
   - Assert that retained source-effect metadata survives save/load even though Auto/Readable final rendering ignores it.
   - Existing translation overlay/export tests are the prior art for this seam.

2. **Chrome Extension overlay seam**
   - Use the existing extension content-overlay harness and actual `TRANSLATION_SUCCESS` message flow.
   - Assert that rendered `.superk-text-bubble` output has the expected separate outline and standard drop-shadow semantics.
   - Cover restored/persisted overlays where practical so cached extension output does not fall back to an older style contract.
   - Treat Server Mode and Direct Mode as equivalent rendering inputs at this seam; transport/model-routing behavior is outside this feature.
   - Existing Chrome Extension content and adaptive overlay tests are the prior art for this seam.

Additional focused tests may retain source-effect sampling coverage to prove that detected source shadow/glow is still collected as evidence. Those focused tests are supporting regressions, not the primary feature acceptance seam.

## Out of Scope

- Changing Source accent detection or the current confidence policy for Source-colored outlines.
- Reworking Gemini model selection, API-key routing, translation prompts, or provider behavior.
- Adding a global shadow strength slider or global shadow presets.
- Adding arbitrary custom shadow controls such as custom color, blur, X offset, or Y offset per region.
- Reproducing detected source shadow/glow automatically for selected Auto regions.
- Introducing per-bubble readability halo as an emergency exception.
- Changing the existing Overlay Subtitle-only background-plate rule.
- Destructively removing historical source `shadow`, `glow`, or readability-halo metadata from saved projects.
- Redesigning unrelated typography, cleaning, inpainting, OCR, or translation UI.
- Resolving the separate Chrome Extension Direct Mode dynamic-Gemini-routing discrepancy.

## Further Notes

The design was stress-tested through Q1–Q20 and the user explicitly confirmed Shared Understanding. ADR 0015, **Uniform Translated Text Shadow**, is accepted and supersedes the per-region automatic shadow/glow rendering and readability-halo escalation details in ADR 0008 and ADR 0012 while leaving their other fill, outline, evidence, and readability decisions intact.

The user explicitly confirmed the two Testing Seams above before this specification was published. The local issue tracker uses one Markdown spec under `.scratch/<feature>/spec.md` and one Markdown file per implementation ticket under the feature's `issues` directory.
