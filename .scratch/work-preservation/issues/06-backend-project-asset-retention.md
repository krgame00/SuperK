# 06: Project-Lifetime Backend Asset Retention & Cascade Deletion

**What to build:** Inpainting cleaner job assets and parent job data on the backend service are tied to the lifetime of the workspace project rather than expiring after a fixed 24 hours. Translators can reopen projects after several days or service restarts and continue to use region cleaning and retry without error. Deleting a project issues an explicit cascading cleanup command to reclaim disk space safely without impacting other retained projects.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Backend cleaning job manager tags assets with project identifiers and removes the 24-hour expiration limitation for active project assets.
- [ ] Region re-clean and retry successfully reconstruct parent job contexts even after multiple days.
- [ ] Project deletion endpoint triggers cascading cleanup of associated backend job assets.
- [ ] Deleting one project never deletes or damages assets belonging to other retained projects.
- [ ] Unit/Integration tests verify asset retention across time simulation and verify clean cascading deletion.
