# 03: Legacy Project & Export Parity

**What to build:** Make existing projects adopt the new automatic shadow semantics without destructively deleting historical `shadow`, `glow`, or readability-halo metadata, and guarantee that the Translation Workspace and exported output render the same visible shadow result for the same translated text.

**Blocked by:** 01 — Uniform Shadow Automatic Rendering Baseline.

**Status:** ready-for-agent

- [ ] Legacy Auto/Readable regions that contain saved source shadow/glow/readability-halo metadata render with the Standard Shadow rather than the saved per-region effect.
- [ ] Legacy source-effect metadata remains intact after load, render, edit, and save unless the user explicitly changes relevant ownership/style data.
- [ ] Legacy projects without newer shadow-control fields load safely and receive the correct default automatic behavior.
- [ ] Workspace Preview and exported image/document output use equivalent final shadow semantics for Auto, Readable, Source-faithful, and Manual Standard/Off states.
- [ ] Export does not reintroduce source shadow/glow or a readability halo that the Workspace did not show.
- [ ] Automatic background-plate restrictions remain unchanged: only permitted Overlay Subtitle cases may receive the existing plate escalation.
- [ ] Dialogue and Narration / Panel Caption continue to use non-plate readability handling and review-required behavior when necessary.
- [ ] Existing saved projects can be reopened and exported without a destructive migration step.
- [ ] High-level Translation Overlay → Export regression coverage demonstrates visible parity and legacy metadata preservation.
