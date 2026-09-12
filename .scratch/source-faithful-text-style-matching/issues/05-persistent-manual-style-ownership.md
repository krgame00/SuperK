# 05: Persistent Manual Style Ownership

**What to build:** Treat manual text styling as a complete user-owned override rather than a partial color tweak. Manual fill, outline presence, outline color, relative thickness, opacity, and supported effect metadata must survive re-rendering and re-translation until the user explicitly chooses to return that bubble to Auto/Original style.

**Blocked by:** 01: Plain Dialogue Source Fidelity.

**Status:** claimed

- [ ] Manual override can represent and preserve fill, outline presence, outline color, relative outline thickness, and opacity together as one coherent style.
- [ ] Supported decorative effect metadata can be retained by a manual override when those effects are available.
- [ ] Automatic source-style recovery does not overwrite a manual profile during re-render.
- [ ] Re-translation updates wording without silently replacing the manual style profile.
- [ ] The user has an explicit path to return a manually styled bubble to Auto/Original style; automation does not reclaim control implicitly.
- [ ] Project persistence preserves manual style ownership across save/load boundaries.
- [ ] Older projects whose profiles predate the richer style model continue to load and render safely.
- [ ] Regression coverage proves manual precedence through the style-resolution and rendered-overlay seams.
