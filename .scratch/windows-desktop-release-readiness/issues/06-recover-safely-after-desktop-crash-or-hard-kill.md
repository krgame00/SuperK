# 06: Recover Safely After Desktop Crash or Hard Kill

**What to build:** After SuperK is forcibly terminated or crashes, the next launch can reclaim stale SuperK-owned workspace or sidecar processes without killing unrelated programs that merely happen to occupy ports 3000 or 8765.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] The desktop shell records sufficient ownership metadata for each managed workspace and sidecar child process to distinguish a stale SuperK child from an unrelated process.
- [x] Ownership verification uses process identity and launch/executable provenance rather than port occupancy alone.
- [x] Normal application shutdown stops managed child processes and clears or updates ownership state consistently.
- [x] After a simulated hard kill or crash, the next launch detects stale owned child processes and reclaims them safely before startup continues.
- [x] A stale process is terminated only when ownership can be verified strongly enough to identify it as SuperK-managed.
- [x] If a required port is occupied and ownership cannot be proven, SuperK does not terminate the unknown process and instead uses the port-conflict flow.
- [x] Relaunch succeeds without requiring Task Manager cleanup when stale owned processes are recoverable.
- [x] Tests cover normal shutdown, hard-kill residue, verified stale ownership, unknown port ownership, and safe relaunch behavior.
