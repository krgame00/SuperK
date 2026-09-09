# 07: Enforce Windows Release-Ready Gate

**What to build:** A Windows artifact is described as release-ready only after the deployed boundaries promised by the desktop specification pass together: packaged local AI inference, diagnostic recovery flows, safe process lifecycle behavior, and a packaged executable smoke test.

**Blocked by:** 02: Validate Packaged AnimeLaMa ONNX Inference; 03: Recover Local Cleaner from Diagnostics; 04: Complete Missing API Key Recovery; 05: Enforce Group-Scoped Quota Cooldown; 06: Recover Safely After Desktop Crash or Hard Kill

**Status:** closed

- [x] Existing unit and workspace regression suites pass before release validation continues.
- [x] The staged AnimeLaMa production inference gate passes through DirectML or the supported CPU fallback using a real image and mask.
- [x] Cleaner recovery proves health check, conditional single restart, post-restart verification, and no automatic page retry.
- [x] Missing API key recovery proves focus, save, credential validation, and user-initiated targeted retry without an automatic request on save.
- [x] Quota recovery proves 429 timing normalization, group-scoped countdown, retry unlock at expiry, and manual targeted retry without automatic retry at zero.
- [x] Failure-group retry verification proves actions target their captured page sets rather than the latest global failure list.
- [x] Normal desktop shutdown terminates managed workspace/sidecar processes and releases the required loopback ports.
- [x] Hard-kill/crash residue followed by relaunch safely recovers only verified SuperK-owned stale processes and never kills an unknown port owner.
- [x] The packaged Windows executable launches without separately starting Node, npm, Python, or terminal windows.
- [x] The packaged application reaches a usable workspace, confirms workspace and cleaner health, and completes at least one packaged local-cleaner inference.
- [x] Any required gate failure blocks `RELEASE READY` status and reports the failing boundary clearly enough for a reviewer to act on it.
- [x] Build success or unit-test success alone cannot mark the Windows artifact release-ready.
