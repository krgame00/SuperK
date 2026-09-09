# Windows Desktop Release Readiness Specification

Status: `ready-for-agent`

## Problem Statement

The Windows desktop bundle can launch the SuperK workspace, but it does not yet preserve all capabilities promised by the accepted desktop architecture. The packaged Python runtime removes PyTorch while the application still exposes LaMa cleaning, so automatic cleaning can silently use a different algorithm and an explicit AnimeLaMa retry can fail.

Translation failure diagnostics also present actions that are not connected to the promised recovery behavior. A safety recovery action can close without enabling Comic Slicing or retrying, local cleaner failures can be reported as unknown failures, and quota failures allow immediate retry instead of respecting a cooldown. A translator therefore cannot trust that the packaged application and its diagnostic actions do what their labels say.

## Solution

Make the Windows portable release preserve the accepted hybrid desktop capability and make every Actionable resolution prompt perform its stated recovery:

1. Bundle and validate the Windows PyTorch runtime required by LaMa so the packaged application supports the same LaMa cleaning paths exposed by the workspace.
2. Classify failures from both cleaning preparation and translation into the shared Translation failure diagnostic taxonomy.
3. Connect every diagnostic action to its real workspace or desktop recovery operation.
4. For quota exhaustion, honor the provider retry guidance, show a countdown, and enable a user-initiated retry only after the cooldown expires.
5. Verify these behaviors through the packaged runtime, the workspace workflow, and the translation API contract rather than relying only on isolated component tests.

## User Stories

1. As a Windows translator, I want the portable application to include every runtime needed by LaMa, so that I do not need to install Python packages manually.
2. As a Windows translator, I want automatic cleaning to use the intended cleaner, so that packaging does not silently reduce cleaning quality.
3. As a Windows translator, I want AnimeLaMa to work when it appears as an available retry option, so that the interface never offers an unavailable capability.
4. As a Windows translator, I want startup or release validation to detect a missing LaMa runtime, so that the problem is found before my first cleaning job.
5. As a Windows translator, I want the application to explain clearly when a required local model or runtime is unavailable, so that I know whether the installation is incomplete.
6. As a batch translator, I want cleaning preparation failures classified separately from translation failures, so that I receive the correct recovery action.
7. As a batch translator, I want an unavailable Python sidecar reported as `LOCAL_SIDECAR_OFFLINE`, so that it is not presented as an unknown translation error.
8. As a batch translator, I want a cleaner recovery action to check or restart the managed sidecar, so that the button performs the operation it promises.
9. As a translator handling a safety-blocked page, I want one action to enable Comic Slicing and retry only the affected pages, so that completed pages are left untouched.
10. As a translator, I want the safety action to update the same setting used by the next translation request, so that the retry actually uses the bypass mode.
11. As a translator, I want a missing-key action to open Settings with the API key field focused, so that I can correct the exact problem immediately.
12. As a translator, I want a network or timeout action to retry only failed pages, so that successful pages are not translated again.
13. As a translator whose Gemini quota is exhausted, I want to see how long I must wait, so that I do not repeatedly submit requests during throttling.
14. As a translator whose quota cooldown has expired, I want to choose when to retry, so that the application does not consume API quota without my action.
15. As a translator with multiple failed pages, I want the cooldown to apply consistently to the affected retry operation, so that each page does not create an independent retry storm.
16. As a translator, I want the countdown to use provider guidance when available, so that the displayed wait reflects the actual rate limit response.
17. As a translator, I want a safe fallback cooldown when provider guidance is absent or invalid, so that the action remains predictable.
18. As a translator, I want closing and reopening the diagnostic view to preserve the active cooldown, so that the restriction cannot be bypassed accidentally.
19. As a translator, I want diagnostic actions to keep their page set and cause association, so that an action does not retry unrelated or newly failed pages.
20. As a reviewer, I want a Windows release check to fail when LaMa cannot execute through the staged runtime, so that a visually successful package build is not mistaken for a working release.
21. As a reviewer, I want workspace-level tests to exercise each advertised recovery action, so that a button that merely dismisses the dialog cannot pass.
22. As a reviewer, I want API contract tests to verify quota status and retry timing metadata, so that the countdown has a reliable source.
23. As a maintainer, I want the diagnostic action label and actual operation to share one contract, so that future UI changes do not create misleading buttons.
24. As a maintainer, I want failures that cannot be recovered automatically to present accurate instructions instead of an automatic-action label, so that the interface never claims an action it cannot perform.

## Implementation Decisions

### 1. Windows LaMa capability

- The Windows portable application retains PyTorch and the runtime libraries required to load and execute the bundled LaMa model.
- LaMa remains an available local cleaner in the Windows release; the implementation will not remove it from the interface or silently redefine the accepted desktop capability to reduce bundle size.
- The packaging process must validate the staged runtime after pruning and before producing the release artifact.
- Validation must load the bundled model and execute a minimal inference through the same cleaner entry point used by a real cleaning job. Importing modules alone is insufficient.
- A failed LaMa validation fails the desktop build with a direct explanation. It must not produce a release artifact described as complete.
- The application may continue to use documented cleaning fallbacks for runtime image-specific failures, but missing packaged dependencies are release failures rather than ordinary fallback conditions.

### 2. Diagnostic action contract

- Every Actionable resolution prompt has an executable workspace or desktop operation matching its label.
- If an operation cannot be performed automatically, its label and description must present truthful manual guidance and must not imply that clicking it performs the recovery.
- `MISSING_KEY` opens Settings and focuses the Gemini API key input.
- `SAFETY_BLOCKED` enables the existing Comic Slicing mode in the state used by translation requests, then retries only pages in the associated failure group.
- `LOCAL_SIDECAR_OFFLINE` invokes the desktop sidecar recovery/check operation when running inside the desktop application. Where that operation is unavailable, the prompt provides accurate manual guidance without claiming to restart the service.
- `NETWORK_OR_TIMEOUT` retries only the failed pages associated with that action.
- Actions operate on stable failure-group identities rather than whatever happens to be in the latest global failure list when the button is pressed.

### 3. Failure classification coverage

- Cleaning preparation failures and translation request failures feed the same diagnostic normalization boundary.
- Sidecar connection refusal, sidecar health failure, and cleaning-service timeout map to `LOCAL_SIDECAR_OFFLINE` when the local service is the failed dependency.
- Network errors involving the Gemini request remain `NETWORK_OR_TIMEOUT`; local loopback failures are not collapsed into that cloud/network category.
- Unknown classification is used only when available structured codes, HTTP status, causal stage, and message evidence cannot identify a supported category.

### 4. Quota cooldown behavior

- A quota response carries normalized retry timing metadata from the translation API to the workspace.
- A valid provider `Retry-After` value is preferred. The API supports both delay-seconds and HTTP-date forms and converts them to a bounded duration.
- When retry guidance is absent or invalid, the system uses a documented default cooldown.
- The workspace stores cooldown as an absolute expiry time so rerenders, modal close/reopen, and ordinary wall-clock drift do not reset it.
- While cooldown is active, quota-related retry controls are disabled and display the remaining time.
- When cooldown expires, the interface enables a retry control. The user initiates the retry; expiration alone does not send an API request.
- The retry targets only the failed pages belonging to the quota failure group.
- Repeated quota responses may extend the expiry but cannot shorten an already active cooldown.

### 5. Scope compatibility

- The feature preserves the existing Windows-only, portable, hybrid-processing decision: cleaning remains local and Gemini translation remains online.
- The behavior applies to the dedicated desktop window and the browser workspace wherever they share the same translation workflow.
- Existing project recovery, confirmed-page revision, and review-gated export behavior remain unchanged.

## Testing Decisions

- Tests assert externally observable behavior and release capability rather than private helper calls.
- The specification uses three acceptance seams because each protects a different deployed boundary.

### 1. Packaged LaMa runtime seam

- Prepare the same staged Python runtime used by the Windows package.
- Load the bundled LaMa model and run a minimal deterministic inference through the production cleaner entry point.
- Fail when PyTorch, required native libraries, the model, or the cleaner route is missing.
- Confirm that the packaged cleaner selection does not silently substitute AOT or Flat for this acceptance case.

### 2. Workspace diagnostic workflow seam

- Drive batch page preparation/translation through the workspace with controlled failure responses.
- Verify that a cleaning-service failure produces `LOCAL_SIDECAR_OFFLINE` rather than `UNKNOWN_ERROR`.
- Verify that the Safety action enables Comic Slicing and retries only the blocked pages.
- Verify that missing-key, sidecar, timeout, and quota actions produce their advertised observable effects.
- Verify that dismissing and reopening the diagnostic modal preserves failure groups and active cooldown.
- Prefer established workspace and translation-hook testing patterns over component-only callback assertions.

### 3. Translation API contract seam

- Simulate upstream HTTP 429 responses with delay-seconds, HTTP-date, missing, malformed, and extreme `Retry-After` values.
- Verify that the API returns `QUOTA_EXHAUSTED` with normalized, bounded retry timing metadata.
- Verify that the workspace disables retry during cooldown and enables it at expiry without automatically sending a request.
- Use a controllable clock so countdown behavior is deterministic and does not make the test suite wait in real time.

### Regression coverage

- Preserve existing successful translation, partial batch failure, retry-failed-pages, environment loading, desktop lifecycle, and project recovery tests.
- Component tests may verify accessibility and rendering, but they do not replace the workspace workflow seam.

## Out of Scope

- Removing LaMa from the accepted Windows desktop capability.
- Adding local LLM translation or making Gemini translation work offline.
- Automatically retrying quota failures when the cooldown expires.
- Changing Gemini safety policies or bypassing upstream enforcement outside the existing Comic Slicing workflow.
- Reworking cleaning quality algorithms, masks, routing heuristics, or model training.
- Implementing cloud sync, authentication, multi-user hosting, macOS, or Linux packaging.
- Redesigning the entire diagnostic modal or filmstrip visual language.
- Repairing pre-existing Chrome-extension-to-desktop handoff behavior unless required to expose a diagnostic recovery operation.

## Further Notes

- The accepted desktop architecture already promises bundled PyTorch and LaMa. This specification restores implementation parity with that decision rather than introducing a new optional cleaner.
- “Actionable” means the click causes the stated recovery operation. A control that only closes the prompt does not satisfy this contract.
- Quota cooldown completion grants permission for the user to retry; it is not an instruction for the application to retry automatically.
- This specification is published in the configured local markdown issue tracker with `ready-for-agent` status.
