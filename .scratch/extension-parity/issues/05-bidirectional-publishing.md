# 05: Bidirectional "Send Back to Reading View" Publishing

**What to build:** In the SuperK editor, pages originating from external reading views display an actionable "Send back to reading view" button in the top toolbar. When the user refines translation text, moves bubbles, or adjusts styling, clicking this button broadcasts the updated translation data back via `/api/extension/publish-back` to the extension content script, instantly updating the live overlay on the active manga web tab and updating the saved reading cache.

**Blocked by:** 04: SuperK Workspace Handoff & Session Append Protocol

**Status:** done

- [x] SuperK editor identifies pages originating from extension handoff and renders "Send back to reading view" in the toolbar.
- [x] `/api/extension/publish-back` receives the updated bubble text, styling, and page identifier.
- [x] Extension background worker receives the published update and forwards it to the matching web tab content script.
- [x] Content script refreshes its DOM overlay and updates the local storage cache with the refined data.
- [x] Integration test verifies round-trip publishing contract and overlay state update.
