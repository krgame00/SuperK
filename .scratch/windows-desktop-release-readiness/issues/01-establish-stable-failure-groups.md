# 01: Establish Stable Failure Groups

**What to build:** Translation and cleaning diagnostics keep a stable failure-group identity that binds one root cause to the exact affected page set and recovery state, so every action continues to target the same failures even after rerenders, modal close/reopen, or later failures elsewhere in the workspace.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] Every actionable diagnostic group receives a stable identity when it is created.
- [x] Each group retains its diagnostic cause and the exact affected page set until the group is resolved or explicitly replaced by a later result.
- [x] Closing and reopening diagnostics, rerendering the workspace, or changing the active page does not change an existing group identity or membership.
- [x] Newly occurring failures do not silently mutate the page set or cause of an older group the user is already reviewing.
- [x] Recovery and retry actions resolve their target from the captured failure-group identity rather than the latest global failure list or modal row index.
- [x] Group-level recovery state can hold retry eligibility and cooldown metadata without leaking that state to unrelated diagnostic groups.
- [x] Workspace-level tests prove stable identity, exact page membership, and targeted action behavior through observable results rather than component callback assertions alone.
