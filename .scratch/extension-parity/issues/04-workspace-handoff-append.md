# 04: SuperK Workspace Handoff & Session Append Protocol

**What to build:** An "Open in SuperK Editor" button is rendered on every translated image. Clicking it sends a handoff payload (original image, cleaned image, detected/translated bubble list with coordinates, and origin URL) to SuperK's local endpoint (`/api/extension/workspace/append`). SuperK appends this page to the active `latest_session` in IndexedDB without clearing existing pages, and brings the SuperK editor tab into focus on the newly appended page.

**Blocked by:** 03: Adaptive Speech Bubble Overlay & Local Persistence

**Status:** done

- [x] `/api/extension/workspace/append` accepts page handoff payload and validates structure.
- [x] SuperK workspace stores the new page in IndexedDB (`latest_session`), safely incrementing total pages and preserving all existing 40+ pages.
- [x] SuperK tab opens or switches to the newly appended page.
- [x] Integration tests verify session integrity, non-destructive appending, and bubble coordinate preservation.
