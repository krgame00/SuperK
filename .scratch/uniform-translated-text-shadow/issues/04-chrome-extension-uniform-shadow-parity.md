# 04: Chrome Extension Uniform Shadow Parity

**What to build:** Make the Chrome Extension reading overlay use the same Uniform translated text shadow semantics as the main SuperK workspace. Server Mode and Direct Mode must render the same neutral Standard Shadow independently from the source-colored outline, and restored/cached overlays must not fall back to the previous outline-only or per-region visual behavior.

**Blocked by:** 01 — Uniform Shadow Automatic Rendering Baseline.

**Status:** ready-for-agent

- [ ] Chrome Extension translated bubbles render the accepted proportional Standard Shadow in addition to their outline treatment.
- [ ] Outline and drop shadow remain visually and semantically separate; the shadow does not replace or recolor the detected/source-derived outline.
- [ ] Server Mode and Direct Mode use equivalent visible shadow semantics for the same translated bubble data.
- [ ] Restored/cached translation overlays render with the current Standard Shadow rather than preserving an obsolete outline-only visual result.
- [ ] Resizing/reflowing the reading overlay keeps shadow proportions coherent with rendered text size.
- [ ] Source-effect metadata from translated bubble data does not cause one extension bubble to gain a different automatic shadow/glow from another.
- [ ] Extension cleanup/toggle/retranslation flows preserve the expected shadow behavior when the overlay is recreated.
- [ ] Existing Chrome Extension overlay tests are extended at the TRANSLATION_SUCCESS seam to assert externally visible shadow and outline behavior rather than private implementation details.
