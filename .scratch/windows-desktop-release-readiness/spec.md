# Windows Desktop Release Readiness Specification

Status: `release-ready`

## Problem Statement

The Windows desktop application can now launch the SuperK translation workspace and its local cleaning service as one program, but a successful package build is not yet sufficient evidence that the release is trustworthy.

The packaged application still needs release-level guarantees in three areas. First, the local AnimeLaMa capability must execute through the actual staged Windows runtime rather than merely existing in source code or passing an import check. Second, every Translation failure diagnostic must distinguish the real failure boundary and perform the recovery operation promised by its label without silently starting unrelated work. Third, abnormal process termination must not cause SuperK to kill arbitrary programs that happen to occupy its ports on the next launch.

A translator should be able to trust that the portable application preserves its advertised local cleaning capability, that recovery actions are safe and truthful, that quota retry behavior cannot create retry storms, and that the application is not described as release-ready until the packaged executable passes the deployed boundaries that users will actually exercise.

## Solution

Make Windows release readiness an explicit, observable contract across the packaged local AI runtime, desktop process orchestration, translation diagnostics, and retry workflow.

1. Use the Windows production AnimeLaMa runtime based on ONNX Runtime, preferring DirectML when available and falling back to CPU when necessary.
2. Validate AnimeLaMa by running a real deterministic inference through the staged production cleaner path before a release is accepted.
3. Separate an unavailable local service from a running service whose cleaner/model failed by using distinct diagnostic categories.
4. Add a desktop cleaner recovery operation that checks health first, performs at most one managed restart when needed, verifies health after restart, and reports the result to the workspace.
5. Keep recovery actions user-controlled: repairing a cleaner, saving an API key, or reaching the end of a quota cooldown makes retry available but does not silently retry affected pages.
6. Give failure groups stable identities so actions, cooldowns, and retries remain attached to the exact pages and cause that created them.
7. Scope quota cooldown state to the affected failure group, using normalized provider guidance when available and a bounded fallback when it is not.
8. Recover stale desktop child processes only when SuperK can prove ownership; otherwise show the existing port-conflict path instead of killing an unknown process.
9. Treat release readiness as a multi-boundary gate. Build success alone is not release success.

## User Stories

1. As a Windows translator, I want the portable application to contain the runtime needed for AnimeLaMa, so that I do not need to install Python packages manually.
2. As a Windows translator, I want AnimeLaMa to execute through the same production cleaner path used by the packaged application, so that a successful build cannot hide a broken cleaner.
3. As a Windows translator, I want DirectML acceleration used when my system supports it, so that local inpainting can benefit from Windows GPU acceleration.
4. As a Windows translator, I want AnimeLaMa to fall back to CPU when DirectML is unavailable or cannot run the model, so that the feature remains usable on supported Windows machines without compatible GPU acceleration.
5. As a reviewer, I want the release check to fail when both DirectML and CPU inference fail, so that an unusable AnimeLaMa capability is never shipped as complete.
6. As a reviewer, I want release validation to process a real image and mask and inspect the produced output, so that module imports alone cannot satisfy the release gate.
7. As a translator, I want a dead or unreachable local cleaning service reported as `LOCAL_SIDECAR_OFFLINE`, so that I know the service itself is unavailable.
8. As a translator, I want a healthy service whose cleaner or model fails reported as `LOCAL_CLEANER_FAILED`, so that I am not told the service is offline when it is actually running.
9. As a translator, I want a cleaner recovery button to check the current health state before restarting anything, so that healthy services are not restarted unnecessarily.
10. As a translator, I want cleaner recovery to perform at most one restart per click, so that a broken environment cannot enter an infinite restart loop.
11. As a translator, I want cleaner recovery to verify health after a restart, so that the interface does not claim recovery before the service is actually ready.
12. As a translator, I want a failed cleaner recovery to remain visible with accurate guidance and a manual retry option, so that failure is not hidden behind a toast or dismissed dialog.
13. As a translator, I want successful cleaner recovery to make retry available without automatically reprocessing pages, so that I remain in control of local AI work.
14. As a translator, I want a missing-key action to open Settings directly at the Gemini API key field, so that I do not need to search for the relevant control.
15. As a translator, I want the Gemini API key field focused and selected when I arrive from a missing-key diagnostic, so that I can immediately replace or enter the value.
16. As a translator, I want a saved API key verified before the diagnostic is considered resolved, so that I do not retry with a key that still cannot be used.
17. As a translator, I want a valid saved key to make retry available without automatically sending translation requests, so that saving credentials does not consume quota unexpectedly.
18. As a translator, I want an invalid key to leave Settings open with an error attached to the API key control, so that I can correct the value in place.
19. As a translator handling a safety-blocked page, I want the recovery action to enable the existing Comic Slicing mode used by the next request, so that the advertised workaround actually changes request behavior.
20. As a translator handling a safety-blocked batch, I want only the pages in that failure group retried, so that successful pages remain untouched.
21. As a translator, I want network and timeout recovery to target only the failed pages associated with that action, so that unrelated pages are not reprocessed.
22. As a translator, I want each diagnostic failure group to retain a stable identity, so that the action I click cannot silently change to a newer set of failures.
23. As a translator, I want newly failed pages to form or join the appropriate new failure state without mutating an older action that I am already reviewing, so that diagnostics remain predictable.
24. As a translator whose Gemini quota is exhausted, I want the cooldown attached to the affected quota failure group, so that unrelated diagnostics are not blocked by a global timer.
25. As a translator, I want all pages in one quota failure group to share one cooldown, so that each page cannot create an independent retry storm.
26. As a translator, I want provider `Retry-After` guidance honored when valid, so that the displayed countdown reflects upstream rate-limit information.
27. As a translator, I want a bounded default cooldown when provider guidance is absent or invalid, so that quota recovery remains predictable.
28. As a translator, I want repeated quota responses to extend but never shorten an active cooldown, so that later upstream guidance cannot accidentally enable retry too early.
29. As a translator, I want closing and reopening the diagnostic view to preserve the absolute cooldown expiry, so that the wait cannot be bypassed by reopening the modal.
30. As a translator, I want the retry control enabled when cooldown expires without sending a request automatically, so that retry remains an explicit user action.
31. As a desktop user, I want a normal application close to stop the managed workspace and cleaner child processes, so that ports 3000 and 8765 are released cleanly.
32. As a desktop user, I want SuperK to recover safely after a hard kill or crash on the next launch, so that stale owned child processes do not require Task Manager cleanup.
33. As a desktop user, I want SuperK to kill a stale child only when it can prove that the process belongs to SuperK, so that unrelated programs using the same port are never terminated.
34. As a desktop user, I want an unknown port owner to trigger the port-conflict interface, so that I can resolve the conflict without risking another application.
35. As a reviewer, I want release readiness to include packaged executable startup and service health checks, so that a successful compiler or packager result is not mistaken for a working program.
36. As a reviewer, I want the release gate to exercise cleaner recovery, API-key recovery, quota cooldown, targeted retry, normal shutdown, and crash recovery, so that the recovery promises are tested at their deployed boundaries.
37. As a maintainer, I want diagnostic labels and executable recovery operations to share one contract, so that future UI changes cannot create misleading actions.
38. As a maintainer, I want failure categories to describe the boundary that actually failed, so that logs, UI, and recovery logic use the same domain language.
39. As a maintainer, I want release validation to prefer externally observable behavior over private helper calls, so that refactoring does not invalidate useful tests.
40. As a maintainer, I want historical build success and source-tree tests treated as supporting evidence rather than the final release gate, so that release status remains meaningful.

## Implementation Decisions

### 1. Windows production local AI runtime

- Windows production AnimeLaMa uses ONNX Runtime rather than requiring PyTorch in the shipped runtime.
- DirectML is the preferred execution provider when available and compatible with the model.
- CPU execution is the supported fallback. A release may pass when DirectML is unavailable but the same production inference succeeds on CPU.
- A release fails when AnimeLaMa cannot execute through either the preferred provider or the CPU fallback, when the model is absent, or when the production cleaner route cannot load and run it.
- Release validation performs a minimal deterministic image-plus-mask inference and verifies a valid output image. Import-only validation is insufficient.
- Missing packaged dependencies are release failures and must not be silently accepted because another cleaner can produce an output.

### 2. Local cleaner diagnostic taxonomy

- `LOCAL_SIDECAR_OFFLINE` means the managed local service is unreachable, unhealthy, not running, or cannot become healthy within the allowed service-health window.
- `LOCAL_CLEANER_FAILED` means the local service is reachable but the selected cleaner, model load, or inference operation fails.
- Local loopback failures are not collapsed into cloud `NETWORK_OR_TIMEOUT` failures.
- Unknown classification is reserved for failures whose structured code, causal stage, HTTP status, and available message evidence cannot identify a supported category.

### 3. Cleaner recovery contract

- Desktop mode exposes an executable cleaner recovery operation to the workspace.
- Recovery first probes current health.
- A healthy service returns a healthy result without restart.
- An unhealthy managed service receives at most one stop/start attempt for each explicit user recovery action.
- The operation verifies service health after restart and returns an observable `recovered` or `failed` result.
- Recovery does not automatically retry cleaning or translation pages.
- The diagnostic view represents recovery progress using explicit states equivalent to idle, checking, restarting, verifying, recovered, and failed.
- A failed recovery remains visible with accurate manual guidance and allows another explicit recovery attempt.
- In environments where desktop recovery is not available, the UI must provide truthful manual guidance rather than claiming that it restarted the cleaner.

### 4. Missing API key recovery

- The missing-key action opens Settings at the Gemini API key control, moves keyboard focus to it, and selects the current value when appropriate.
- Saving a key from this recovery path triggers key validation before the missing-key diagnostic is considered resolved.
- Validation success makes the original failed group eligible for user-initiated retry; it does not automatically send a translation request.
- Validation failure keeps Settings open and presents the error at the API key control.

### 5. Stable failure groups and targeted actions

- Every actionable failure group receives a stable identity at creation time and retains that identity until the group is resolved or explicitly replaced by a later failure result.
- A group records its diagnostic cause and the exact affected page set.
- Actions operate on the group identity and its captured page set, not on whichever failures happen to be globally current when the user clicks.
- Safety recovery enables the existing Comic Slicing/NSFW bypass state consumed by the translation request and retries only the associated group when the user accepts the action.
- Network/timeout retry targets only the associated failed pages.
- Cleaner and credential repair do not automatically retry; they transition the affected group into a state where the user may explicitly retry.

### 6. Quota cooldown behavior

- Quota cooldown belongs to the affected failure group rather than one global workspace timer.
- Pages within the same quota failure group share one cooldown and one retry action.
- A valid provider `Retry-After` value is preferred. Delay-seconds and HTTP-date forms are normalized to a bounded absolute expiry time.
- Missing or invalid provider timing uses the documented bounded fallback cooldown.
- Repeated quota responses may extend an active expiry but cannot shorten it.
- Closing and reopening diagnostic UI does not reset the expiry.
- While cooldown is active, the quota retry control is disabled and displays remaining time.
- Expiry enables manual retry; expiry itself never sends a translation request.
- Manual retry targets only the pages captured by that quota failure group.

### 7. Desktop child-process ownership and crash recovery

- Normal application shutdown remains responsible for stopping the managed workspace server and Python sidecar immediately.
- A hard kill or process crash is recovered on the next launch rather than relying on shutdown hooks that cannot execute after forced termination.
- SuperK records enough ownership metadata for its managed child processes to distinguish a stale SuperK process from an unrelated program. Ownership evidence includes process identity and executable/launch provenance sufficient to avoid port-only termination decisions.
- On the next launch, stale processes are terminated only when ownership can be verified safely.
- If a required port is occupied and ownership cannot be proven, SuperK uses the existing port-conflict flow and does not terminate the unknown process.

### 8. Release-readiness definition

- A Windows artifact is not release-ready merely because application build, Electron packaging, or unit tests succeed.
- Release readiness requires all accepted test seams below to pass against the staged or packaged runtime as appropriate.
- A failed required seam blocks release status and reports the failing boundary directly.

## Testing Decisions

Tests should assert externally observable behavior at the highest practical boundary. Private helper calls may be unit-tested as supporting coverage, but they do not replace release-seam tests.

The accepted test seams are:

### 1. Packaged local AI inference seam

- Prepare the exact staged runtime and model assets used by the Windows package.
- Run a deterministic AnimeLaMa image-plus-mask inference through the production cleaner entry point.
- Prefer DirectML when available and record the execution provider used.
- If DirectML cannot execute, repeat through the supported CPU fallback.
- Verify a valid output image, expected dimensions, and no silent substitution of another cleaner for the acceptance case.
- Fail the release seam when neither supported provider can execute AnimeLaMa.

### 2. Workspace diagnostic workflow seam

- Drive controlled preparation and translation failures through the workspace workflow rather than testing the diagnostic modal only in isolation.
- Verify sidecar unavailability becomes `LOCAL_SIDECAR_OFFLINE` and a reachable service with a cleaner/model failure becomes `LOCAL_CLEANER_FAILED`.
- Verify stable group identity and exact page membership survive UI rerenders and modal close/reopen.
- Verify Safety recovery changes the request state and targets only the captured group.
- Verify network/timeout retry targets only the captured group.
- Verify cleaner and missing-key recovery do not silently retry pages after repair.

### 3. Desktop cleaner recovery seam

- Exercise the renderer-to-desktop recovery boundary through the actual desktop bridge.
- Verify healthy probe returns without restart.
- Verify an unhealthy managed sidecar gets one restart attempt and a post-restart health verification.
- Verify failed recovery remains observable and does not enter an automatic restart loop.
- Verify successful recovery enables a later user-initiated targeted retry.

### 4. Missing-key recovery seam

- Trigger a missing-key diagnostic through the workspace.
- Verify Settings opens at the API key input, keyboard focus reaches that control, and its current value is selected when appropriate.
- Verify a saved valid key is checked and resolves the credential condition without automatically retrying translation.
- Verify an invalid key leaves Settings open with an actionable control-level error.

### 5. Translation API quota contract seam

- Simulate upstream HTTP 429 responses with delay-seconds, HTTP-date, missing, malformed, and extreme `Retry-After` values.
- Verify normalized bounded retry timing metadata reaches the workspace.
- Use a controllable clock to verify group-scoped countdown, disabled retry during cooldown, enablement at expiry, and no automatic request at expiry.
- Verify repeated quota responses extend but never shorten the active group expiry.
- Verify manual retry uses the original failure group page set.

### 6. Desktop lifecycle seam

- Verify normal close terminates the managed workspace and cleaner processes and releases the expected loopback ports.
- Simulate a hard-kill/crash residue and relaunch the application.
- Verify stale managed children are reclaimed only when ownership can be proven.
- Verify an unknown process occupying a required port is not killed and instead produces the port-conflict path.

### 7. Packaged executable smoke seam

- Launch the packaged Windows executable without separately starting Node, npm, Python, or terminal windows.
- Verify the desktop shell reaches a usable workspace, the workspace server responds, the cleaner health endpoint responds, and the main application window becomes usable.
- Exercise at least one packaged local-cleaner inference before declaring the artifact release-ready.

### Release gate order

1. Existing unit/workspace regression tests pass.
2. Staged AnimeLaMa ONNX inference passes on DirectML or supported CPU fallback.
3. Cleaner recovery health → conditional restart → health verification passes.
4. Missing API key focus → save → verify flow passes.
5. Quota 429 → countdown → unlock → manual targeted retry flow passes.
6. Failure-group targeted retry behavior passes for relevant diagnostics.
7. Normal shutdown releases managed child processes and ports.
8. Hard-kill residue → relaunch safely recovers only owned processes.
9. Packaged executable smoke and local-cleaner inference pass.

Only after all required gates pass may the Windows artifact be described as release-ready.

## Out of Scope

- Reintroducing PyTorch solely to satisfy the previous Windows packaging design.
- Requiring DirectML on every supported machine when CPU inference succeeds through the supported production path.
- Automatically retrying cleaning or translation immediately after cleaner recovery, credential validation, or quota expiry.
- Killing arbitrary processes based only on occupancy of ports 3000 or 8765.
- Adding a permanent Windows service or watchdog solely to guarantee child termination after the main Electron process is forcibly killed.
- Adding local LLM translation or making Gemini translation work offline.
- Changing Gemini safety policy beyond the existing Comic Slicing/NSFW bypass workflow.
- Reworking cleaning quality algorithms, masks, routing heuristics, or model training.
- Redesigning the entire workspace, diagnostic modal, or filmstrip visual language.
- macOS or Linux packaging.
- Cloud sync, authentication, or multi-user hosting.

## Further Notes

- The accepted Windows production architecture is now ONNX Runtime with DirectML preferred and CPU fallback, not a mandatory packaged PyTorch runtime.
- `LOCAL_SIDECAR_OFFLINE` and `LOCAL_CLEANER_FAILED` intentionally describe different failure boundaries and should not be merged for UI convenience.
- “Recovered” means the dependency or credential condition is ready again. It does not mean the affected pages have already been retried.
- A failure-group identity is part of the recovery contract because it preserves the association between cause, page set, cooldown, and action across later workspace changes.
- A forced process termination cannot execute normal Electron shutdown hooks. Safe recovery therefore happens on the next launch using ownership evidence rather than unsafe port-based process killing.
- The existing package build and source-tree tests remain valuable regression evidence, but neither is sufficient alone to mark the Windows release ready.
