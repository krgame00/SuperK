# 03: Quality-First Adaptive ROI Cleaning

**What to build:** Route local neural cleaning between localized ROI work and full-page work using a deterministic, quality-first Adaptive cleaning scope policy. Localized masks should avoid unnecessary full-page LamaLarge inference when safe, while nearby regions may be merged and distributed/oversized layouts must fall back to full-page cleaning. Optimization must preserve the same authorized text-removal mask and protected artwork guarantees.

**Blocked by:** None (can start immediately).

**Status:** implemented (deterministic pipeline checks passed; pytest unavailable)

**Evidence (2026-09-10):** normalized adaptive scope routing, ROI context padding, deterministic clustering, full-page fallback, route/inference telemetry, and no-mask identity behavior are implemented. Direct execution of the adaptive scope and pipeline test functions passed through the bundled Python runtime; `pytest` is unavailable in that runtime.

- [ ] Adaptive cleaning scope uses normalized page-relative evidence including mask coverage, spatial spread, cluster count, and aggregate ROI area rather than fixed pixel-size rules.
- [ ] A localized eligible mask can route through ROI cleaning with enough contextual padding for reconstruction.
- [ ] Nearby or overlapping eligible regions may be merged when that reduces inference work without making the crop inefficient.
- [ ] Distant regions are not blindly merged into one oversized crop; policy can keep localized work separate or choose full-page cleaning when aggregate ROI work is no longer advantageous.
- [ ] When merged/aggregate ROI coverage exceeds the internal policy threshold, the page routes to full-page cleaning instead of creating an ROI that is effectively the whole page.
- [ ] Equivalent normalized layouts at different source resolutions produce equivalent routing decisions.
- [ ] ROI context may enlarge model input, but committed output pixels remain constrained to the authorized cleaning support.
- [ ] Protected artwork/regions remain unchanged under ROI cleaning.
- [ ] A page with no eligible text-removal mask bypasses neural inpainting and remains pixel-identical.
- [ ] Scope thresholds are deterministic internal policy and are not exposed as normal user settings in this release.
- [ ] Benchmark/diagnostic output can identify the chosen cleaning route and relevant normalized routing evidence without changing runtime correctness decisions.
- [ ] Production-pipeline tests cover a small ROI, nearby masks that merge, spatially distributed masks, aggregate ROI full-page fallback, cross-resolution equivalence, protected-pixel preservation, and no-mask identity.
