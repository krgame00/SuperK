# 01: Uniform Shadow Automatic Rendering Baseline

**What to build:** Make automatically rendered translated text use one Uniform translated text shadow across Auto, Auto → Readable fallback, explicit Readable, and admitted Source-faithful rendering. The visible automatic result must no longer vary because one region happened to expose a detected source shadow, glow, or readability halo. Source effect metadata may still be detected and retained as evidence, but automatic rendering must use the fixed proportional standard shadow defined by ADR 0015, including ordinary dialogue on clean or white speech balloons.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Auto, Auto → Readable fallback, explicit Readable, and admitted Source-faithful translated text all resolve to the same neutral proportional Standard Shadow.
- [ ] The Standard Shadow uses the accepted values: `#1e1e1e`, opacity `0.80`, blur ratio `0.15`, offset-X ratio `0.08`, offset-Y ratio `0.08`.
- [ ] Shadow dimensions scale with rendered text size rather than a fixed pixel-only treatment.
- [ ] Detected source `shadow` and `glow` remain available as source evidence but do not override automatic rendered shadow.
- [ ] Per-region readability halo no longer produces a visually stronger or additional automatic shadow on one bubble.
- [ ] Readability escalation keeps fill/outline decisions authoritative and does not strengthen shadow per region.
- [ ] Plain dialogue on a simple/white speech balloon still receives the same Standard Shadow as other automatic translated text.
- [ ] Source-colored outline behavior remains independent from the neutral shadow and is not replaced by this ticket.
- [ ] Existing source-effect detection regression coverage still proves that shadow/glow evidence can be extracted even though automatic rendering ignores those effects.
- [ ] High-level Translation Overlay → Resolved Style behavior has regression coverage for at least Auto, Readable fallback, Source-faithful, and plain speech-balloon cases.
