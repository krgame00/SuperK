# 03: Recover Local Cleaner from Diagnostics

**What to build:** When local cleaning fails, the translator sees whether the local service itself is unavailable or whether a reachable cleaner/model failed, and desktop mode provides a real health-check and conditional-restart recovery action without automatically retrying pages.

**Blocked by:** 01: Establish Stable Failure Groups

**Status:** closed

- [x] Connection refusal, stopped process, failed health checks, and service-health timeout are classified as `LOCAL_SIDECAR_OFFLINE`.
- [x] A reachable sidecar whose selected cleaner, model load, or inference fails is classified as `LOCAL_CLEANER_FAILED` rather than offline, cloud timeout, or unknown.
- [x] The cleaner recovery action checks current sidecar health before attempting any restart.
- [x] A healthy sidecar returns a healthy/recovered result without restarting the process.
- [x] An unhealthy managed sidecar receives at most one stop/start attempt for each explicit user recovery click.
- [x] Recovery verifies sidecar health after restart before reporting success.
- [x] The diagnostic UI exposes observable recovery states equivalent to checking, restarting, verifying, recovered, and failed.
- [x] Successful recovery makes the associated failure group eligible for a later user-initiated retry but does not automatically retry cleaning or translation.
- [x] Failed recovery remains visible with accurate manual guidance and allows another explicit recovery attempt.
- [x] Browser or non-desktop environments do not claim an automatic restart when the desktop recovery operation is unavailable.
- [x] Desktop/workspace tests exercise the renderer-to-desktop recovery boundary and verify classification, recovery result, and preserved failure-group scope.
