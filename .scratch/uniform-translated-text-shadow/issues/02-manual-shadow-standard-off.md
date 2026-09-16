# 02: Manual Shadow Standard / Off

**What to build:** Give Manual text ownership a minimal explicit shadow control with two states: `Standard` and `Off`. Manual users must be able to disable the Uniform translated text shadow intentionally without losing control when they edit other text properties, move or resize text, save/reload, or retranslate.

**Blocked by:** 01 — Uniform Shadow Automatic Rendering Baseline.

**Status:** ready-for-agent

- [ ] Manual appearance controls expose exactly `Standard` and `Off` for shadow in this change; no custom color/blur/offset sliders are added.
- [ ] A Manual region defaults to Standard Shadow unless the user explicitly selects Off.
- [ ] Selecting Off removes the rendered Standard Shadow for that region and remains authoritative until the user re-enables Standard or returns the region to automatic ownership.
- [ ] Editing Manual fill color, outline color, outline thickness, wording, font properties, position, or size does not implicitly toggle the selected shadow state.
- [ ] Manual Standard/Off survives save/load and legacy-compatible serialization.
- [ ] Retranslation or style reconciliation preserves the Manual shadow choice alongside other Manual ownership state.
- [ ] Automatic readability logic may not re-enable a Manual shadow that the user explicitly turned Off.
- [ ] Translation Overlay interaction coverage proves Standard/Off behavior and persistence through representative Manual edits.
