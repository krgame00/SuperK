# Local Project Recovery, Work Preservation & Review-Gated Export

Status: ready-for-agent
Triage: ready-for-agent
Domain Glossary: CONTEXT.md
Reference: docs/adr/0002-local-project-recovery-and-review.md, docs/2026-09-08-system-review-interview.md

---

## Problem Statement

Manga translation team members working across the local SuperK translation workspace and browser reading view experience several critical points of failure where user effort and translation work are lost, unverified content is exported, or stale outputs are generated:

1. **Lost Translations on Failed Re-clean**: When a translator triggers a re-clean operation on a manga page and the inpainting engine fails (due to transient network drop, timeout, or backend error), the workspace unconditionally invalidates and deletes the existing translation bubbles and rendered assets. The user is left with a blank canvas and has lost all their previously translated dialogue.
2. **Unsaved Direct Canvas Edits & Stale Exports**: Directly moving dialogue bubbles, adjusting text, or executing undo/redo actions on the workspace canvas does not reliably trigger autosave or advance the persistence dependency. Furthermore, rendered image export caches are not evicted on overlay edits, causing exported manga books and page images to silently output stale, pre-edit translations.
3. **Save Concurrency Overwriting Rapid Typing**: When a translator makes edits while an asynchronous autosave to local IndexedDB is in-flight, the save completion callback clears the shared dirty state without checking if new edits arrived during the write. Edits made during that window are never saved and disappear upon browser refresh.
4. **Dropped Reading-Site Associations on Reload**: Autosave reconstructs saved workspace pages without preserving their originating website metadata (`originUrl`). After refreshing or reopening the browser, the translator can no longer publish refined translations back to the original reading view.
5. **Publication Polling Overwriting Reading View**: The Chrome extension's publication polling mechanism re-applies older editor snapshots over newer reader actions on the reading website, reverting deliberate deletions or retranslations.
6. **Premature Backend Asset Expiry**: Cleaned assets and inpainting parent jobs expire after a fixed 24 hours on the backend, preventing translators from adjusting or retrying region cleaning when reopening projects after several days.
7. **Unconfirmed Export of Uncertain Content**: Pages containing low-confidence text detection or uncertain inpainting can be exported without human verification, risking publication of corrupted manga artwork or mistranslations.

---

## Solution

Establish an ironclad contract for work preservation, local persistence, and review-gated export across the translation workspace and reading view:

1. **Atomic Invalidation on Clean Replacement**: A failed re-clean operation leaves all existing translation bubbles, inpainting backgrounds, and rendered images untouched. Translation caches are evicted only after a replacement clean has succeeded.
2. **Per-Page Monotonic Version Autosave**: Track page dirty states using monotonic revision numbers rather than mutable sets. An in-flight save clears the dirty flag only up to the revision it captured, guaranteeing that edits typed during a save remain marked dirty and trigger a follow-up write.
3. **Canvas Mutation Synchronization & Cache Eviction**: Every bubble adjustment, text edit, undo, or redo advances the page's revision version, triggers the autosave debounce timer, and invalidates derived rendered export images.
4. **Persistent Origin & Handoff Metadata**: Ensure `originUrl` and page metadata survive session serialization to and from IndexedDB so the "Send back to reading view" link remains functional across reloads.
5. **Deduplicated Extension Publication**: Apply strictly monotonic cursor filtering and sequence identifiers to publication updates so polling ignores already applied snapshots and cannot overwrite newer reading changes.
6. **Project-Lifetime Clean Asset Retention**: Link inpainting parent assets and masks to project lifetime, retaining them until explicit project deletion so older projects remain editable after several days or service restarts.
7. **Human Review Confirmation Gate**: Require explicit human confirmation before exporting pages flagged with uncertain cleaning or translation; any subsequent edit to text or image automatically invalidates confirmation.

---

## User Stories

1. As a translator in the translation workspace, I want a failed re-clean attempt to leave my existing translation and bubbles intact, so that I never lose previously translated dialogue due to a transient cleaning error.
2. As a translator, I want any direct bubble adjustment or text edit on the canvas to immediately mark the page as dirty and schedule an autosave, so that my edits are saved to IndexedDB without requiring manual intervention.
3. As a translator, I want undo and redo operations to advance the page save revision, so that reverting a change is reliably persisted to local storage.
4. As a translator, I want edits made while a save is currently in-flight to remain marked as dirty, so that my rapid typing is not lost when the previous save completes.
5. As a translator, I want the workspace to clearly distinguish between saved and unsaved changes in the UI status indicator, so that I know when it is safe to close or reload the browser.
6. As a translator, I want exported page images and book exports to always render from the latest bubble positions and text, so that exported files never contain stale or pre-edit dialogue.
7. As a translator, I want my workspace session to retain the reading-site association (`originUrl`) across browser refreshes, so that I can use "Send back to reading view" even after reopening the browser.
8. As a translator who opened an image from the reading view, I want the cleaned image to transfer into the translation workspace as a persistent Data URL, so that the inpainted clean background is not lost when saved to IndexedDB.
9. As a manga reader on the reading site, I want publication updates from the workspace to be applied once and deduplicated, so that polling does not repeatedly overwrite newer reading changes or undo a deletion.
10. As a translator returning to a project after several days, I want region re-cleaning and retry to work seamlessly, so that cleaned assets have not been prematurely deleted by a 24-hour expiration timer.
11. As a team member, I want deleting a project to clean up all associated backend assets, so that disk space is reclaimed without affecting any other active projects.
12. As a quality reviewer, I want pages with low-confidence text detection or uncertain inpainting to be flagged as requiring review, so that questionable translations are not exported accidentally.
13. As a quality reviewer, I want to explicitly confirm flagged pages before export, so that our team only publishes verified dialogue and artwork.
14. As a quality reviewer, I want any subsequent edit to text or image on a confirmed page to automatically reset its confirmed status, so that new changes must be re-verified before export.
15. As a translator, I want the export dialog to warn me if any pages still require review and prevent unconfirmed export, so that team quality standards are strictly enforced.
16. As a translator, I want the extension settings synchronization to include my active workspace API key and custom glossary, so that reading view translations reflect the same terminology as the full editor.
17. As a manga reader, I want reading overlays to stay visible on the page indefinitely while reading, rather than being forcefully removed after 120 seconds.
18. As a manga reader, I want lazy-loaded manga images to be checked against cached translations as they scroll into view, so that long webtoon chapters load translations seamlessly.

---

## Implementation Decisions

1. **Atomic Invalidation State Machine**:
   The cleaning service caller must yield an explicit success indicator. The translation hook invalidates cached bubbles and pre-rendered images if and only if the cleaning replacement succeeds. On failure, the existing bubbles, inpainted clean background, and render caches remain completely untouched.

2. **Per-Page Monotonic Version Tracking**:
   Replace mutable shared dirty sets with a mapping of page identifiers to monotonic revision numbers (`pageRevisions: Map<string, number>`). When an autosave operation dispatches, it records the revision number for each page being written. Upon successful persistence to IndexedDB, the save handler advances the `lastSavedRevision` to the recorded snapshot, leaving any newer revision dirty and queuing a subsequent autosave.

3. **Synchronized Overlay Mutation & Export Cache Eviction**:
   All canvas mutation events (bubble drag, text edit, font or style change, undo, redo) trigger two coordinated actions: (a) increment the page's revision version and notify the autosave scheduler; (b) immediately evict any cached rendered export image for that page. When an export is initiated, pages without a valid render cache are re-rendered from active bubble overlays.

4. **Handoff Asset Normalization & Origin Metadata**:
   The workspace handoff endpoint converts raw Base64 cleaner assets into normalized Data URLs before writing to the project store. Project session serialization explicitly includes `originUrl` alongside page image data, and the workspace UI checks this metadata to render the "Send back to reading view" action.

5. **Publication Sequence IDs and Strict Monotonic Cursors**:
   The publication bridge assigns strictly increasing sequence identifiers to each publication entry. The Chrome extension background script maintains the highest applied sequence ID and ignores any incoming publication whose sequence ID is less than or equal to the recorded cursor, preventing duplicate broadcasts or replay overwrites.

6. **Project-Lifetime Clean Asset Retention**:
   The backend inpainting service links job assets to a project identifier rather than a fixed 24-hour time-to-live. Cleaning assets and parent job data are retained until the project is deleted. Project deletion issues a cascading delete command to the backend to reclaim disk storage safely without impacting other retained projects.

7. **Review Confirmation Gate in Export Workflow**:
   The project store tracks a `reviewStatus` (`unreviewed`, `confirmed`, `clean`) per page, coupled with a hash of the approved text and image. The export manager evaluates all candidate pages; if any page has an unconfirmed status, the export is blocked and displays a prompt requiring reviewer confirmation. Any subsequent change to the page's image or text resets `reviewStatus` to `unreviewed`.

---

## Testing Decisions

- **What makes a good test**: Tests must verify external behavior across lifecycles (persistence after reload, preservation upon error, export contents, deduplication) rather than testing internal private functions or implementation details.
- **Modules Tested**:
  - `tests/cleaning/projectStore.test.ts`: Per-page revision tracking, `originUrl` serialization, clean asset persistence.
  - `tests/translation/useTranslation.*.test.tsx`: Atomic clean recovery (failed re-clean preserving bubbles), concurrent save handling, undo/redo revision advancement.
  - `tests/export/exportManager.test.ts`: Review confirmation gating, confirmation invalidation on edit, export cache eviction ensuring fresh rendered overlays.
  - `tests/extension/publishBack.test.ts` & `tests/chrome-extension/bidirectionalPublishing.test.ts`: Monotonic cursor filtering, publication deduplication, reading deletion non-reversal.
  - `tests/cleaning/client.test.ts` / backend cleaner tests: Project-scoped asset retention and deletion cascade.
- **Prior Art**:
  - `tests/cleaning/projectStore.test.ts`
  - `tests/translation/useTranslation.atomicCache.test.tsx`
  - `tests/translation/useTranslation.atomicCancel.test.tsx`
  - `tests/export/exportManager.test.ts`
  - `tests/extension/publishBack.test.ts`

---

## Out of Scope

- Multi-tenant cloud hosting, user authentication, and network permissions (local trusted team installation remains the agreed scope).
- Automated browser data migration across distinct physical devices.
- Automatic AI resolution of uncertain translations without human reviewer involvement.

---

## Further Notes

- Fully adheres to ADR 0001 (Extension Parity Scope) and ADR 0002 (Local Project Recovery and Review).
- Employs domain vocabulary defined in `CONTEXT.md` throughout all specifications and tests.
