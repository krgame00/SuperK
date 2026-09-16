# 05: Cross-Surface Regression & Release Gate

**What to build:** Prove the Uniform translated text shadow feature is consistent and safe across the confirmed high-level seams before release. This ticket closes the feature only when Web Workspace, Export, Manual ownership, legacy projects, and Chrome Extension all satisfy ADR 0015 without regressing source-colored outline behavior or source-effect evidence capture.

**Blocked by:** 02 — Manual Shadow Standard / Off; 03 — Legacy Project & Export Parity; 04 — Chrome Extension Uniform Shadow Parity.

**Status:** ready-for-agent

- [ ] Confirm the primary Translation Overlay → Resolved Style → Export seam passes for Auto, Auto → Readable, explicit Readable, Source-faithful, Manual Standard, and Manual Off.
- [ ] Confirm the Chrome Extension TRANSLATION_SUCCESS overlay seam passes for both current and restored/cached translation behavior.
- [ ] Verify Standard Shadow values and proportional scaling are consistent across Web preview, export, and Extension output.
- [ ] Verify ordinary speech-balloon dialogue receives the same automatic Standard Shadow rather than conditionally losing it.
- [ ] Verify per-region source `shadow`, `glow`, and readability halo cannot alter automatic final shadow intensity while source shadow/glow detection evidence remains available.
- [ ] Verify Manual Off remains Off through editing, layout changes, save/load, and retranslation until explicitly changed.
- [ ] Verify legacy effect metadata remains preserved and does not require destructive migration.
- [ ] Verify source-colored outline policy remains unchanged and visually separate from the neutral shadow.
- [ ] Run the focused color/style, Translation Overlay/export, and Chrome Extension suites and resolve any behavioral regressions.
- [ ] Run TypeScript validation and the full project regression suite before marking the feature complete.
- [ ] Record final verification evidence without resetting, cleaning, or discarding unrelated dirty repository work.
