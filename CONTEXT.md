# Manga Translation Workspace

This context defines the image regions, visual styles, desktop boundaries, and recovery language used while cleaning and translating manga pages.

## Language

**Page awaiting review**:
A manga page with uncertain cleaning or translation results that requires a person's confirmation before export.
_Avoid_: Failed page, approved page

**Confirmed page revision**:
The particular image and text of a page that a person has reviewed and accepted for export. Changing either invalidates that confirmation and returns the page to review.
_Avoid_: Permanently approved page, automatic approval

**Text-removal mask**:
The pixels that the cleaner is authorized to replace. Uncertain character artwork stays outside this mask even when that leaves small text remnants.
_Avoid_: Cleaning box, OCR rectangle

**Glyph mask**:
The pixels belonging to the visible shapes of detected letters, including their fill and outline. Artwork elsewhere inside the surrounding text region is not part of the glyph mask.
_Avoid_: Bounding-box mask, crop mask

**Evidence-supported text**:
A text candidate confirmed by a primary text detector or OCR; visual hints such as dark marks on skin are supporting evidence only.
_Avoid_: Tattoo candidate, likely mark

**Text color profile**:
The separately detected fill and outline colors of a glyph. A profile is usable only when its glyph evidence is sufficiently reliable.
_Avoid_: Average crop color, foreground color

**Nearby color profile**:
A reliable text color profile from a neighboring text region on the same page, used only when the current glyph color cannot be determined confidently.
_Avoid_: Nearest pixel color, background fallback

**Reading view**:
The translated manga page shown on its original reading website, where the reader can compare the translation with the original image.
_Avoid_: Full editor, translation workspace

**Translation workspace**:
The full editing environment for inspecting and refining a manga page and its translation. Readers enter this workspace from the reading view when detailed editing is needed.
_Avoid_: Reading overlay, extension popup

**Inpainted clean background**:
The restored page asset produced by the inpainting pipeline, where detected text glyphs are removed and underlying manga artwork is reconstructed.
_Avoid_: Blanked background, white mask canvas

**Loading scrim overlay**:
The non-intrusive centered visual container placed precisely over an active manga panel in the reading view while inpainting and translation are underway, providing progress feedback without modifying the host site's layout or DOM styling.
_Avoid_: Status badge, floating pill, host wrapper

**Desktop application shell**:
The native Windows host window and process manager that encapsulates the translation workspace into a standalone desktop application window, orchestrates child server lifecycles, and eliminates manual terminal operation.
_Avoid_: Browser wrapper, web shortcut

**Python sidecar service**:
The background child process managed by the desktop application shell that hosts local neural network models for text detection, segmentation, and inpainting on local hardware.
_Avoid_: External cleaner, auxiliary daemon

**Local IPC bridge**:
The loopback and desktop communication boundary enabling the desktop shell, internal translation workspace, and browser extension to exchange images, job tokens, health/recovery commands, and published updates.
_Avoid_: Remote gateway, cloud webhook

**Translation failure diagnostic**:
The categorized, root-cause assessment of why a manga page could not be prepared or translated, distinguishing credentials, quota exhaustion, safety policy blocks, local service unavailability, local cleaner failure, and cloud/network failures.
_Avoid_: Generic error, retry message, vague failure

**Actionable resolution prompt**:
A contextual user guidance and interface action offered directly upon translation failure that performs the stated recovery operation or gives truthful manual guidance when automatic recovery is unavailable.
_Avoid_: Dismissible alert, unguided error toast

**Local sidecar offline failure**:
A failure where the managed local Python sidecar service itself is unreachable, unhealthy, stopped, or unable to become healthy within the service-health window.
_Avoid_: Cleaner model error, generic network error

**Local cleaner failure**:
A failure where the Python sidecar service is reachable but the selected cleaner, model loading, or inference operation fails.
_Avoid_: Sidecar offline, cloud timeout

**Failure group**:
A stable diagnostic unit that binds one root cause to the exact affected page set and any recovery state such as cooldown or retry eligibility until that group is resolved or replaced by a later result.
_Avoid_: Current failures array, transient modal row

**Cleaner recovery operation**:
A user-initiated recovery action that checks sidecar health, performs at most one managed restart when necessary, verifies health afterwards, and reports whether the cleaner service is ready again without automatically retrying pages.
_Avoid_: Blind restart, automatic page retry

**Quota cooldown**:
The absolute wait-until time attached to one quota failure group during which that group's retry action is disabled; expiration enables user-initiated retry but never sends a request by itself.
_Avoid_: Global retry lock, auto-retry timer

**Owned desktop child process**:
A workspace or sidecar process for which the desktop application can verify launch ownership strongly enough to reclaim it safely after an abnormal prior termination.
_Avoid_: Any process using port 3000 or 8765
