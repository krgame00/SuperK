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

**Source text style profile**:
The source-faithful visual style recovered from original glyph evidence, including fill color, whether an outline exists, outline color and relative thickness, opacity, and any confidently detected gradient, shadow, or glow.
_Avoid_: Readability preset, global text style, average crop style

**Style confidence band**:
The confidence tier assigned to a recovered source text style: high confidence is eligible for faithful rendering only after its source evidence is validated, medium confidence must be re-analyzed before fallback, and low confidence must not be treated as exact source style.
_Avoid_: Generic OCR confidence, arbitrary score

**Source style evidence gate**:
The validation boundary that decides whether a recovered Source text style profile is supported by the visible text itself rather than surrounding artwork or background. Passing the gate requires trustworthy text-local evidence and sufficient visual separation from the local background.
_Avoid_: Confidence score alone, raw crop acceptance, background-color guess

**Text style category**:
The semantic visual class of a source text region used to constrain style inheritance, at minimum Dialogue, Narration / Panel Caption, SFX / Decorative, or Overlay Subtitle. Panel captions are authored narration inside the manga layout; Overlay Subtitles are wide, usually line-like text placed directly over artwork rather than inside a speech balloon or narration panel.
_Avoid_: Ambiguous Caption, nearest bubble type, color family

**Readable fallback style**:
An adaptive safe text style used when source-style evidence is invalid or insufficient. It is selected against the actual Inpainted clean background under the Translated glyph footprint rather than from a fixed white-text preset, and it always includes an outline. The system evaluates multiple conservative fill/outline pairs, considers both broad readability and weak local regions, prefers dark fill on white or near-white balloons, and may escalate from normal outline to thicker outline and then controlled shadow/halo. Automatic background plates are a last-resort Overlay Subtitle behavior only.
_Avoid_: Fixed white fallback, source text style profile, guessed source color, silent style inheritance

**Translated glyph footprint**:
The page area actually occupied by the laid-out translated glyphs plus the small margin needed to evaluate outline or readability separation. Adaptive Readable decisions sample the Inpainted clean background against this footprint instead of treating the whole OCR box as the readability surface.
_Avoid_: Entire OCR box, source glyph mask, text-removal mask

**Readability gate**:
The automatic validation that decides whether a candidate text style remains legible over the actual background. It considers multiple locations across the Translated glyph footprint, including both broad contrast and weak local regions; the current behavioral target is roughly 4.5:1 across most sampled areas while avoiding materially weak local regions around 3:1 when a stronger safe candidate is available.
_Avoid_: Average crop brightness, source confidence score, Manual style enforcement

**Manual style override**:
A user-owned text style that automation may warn about but must not modify until the user explicitly returns the region to Auto or Readable behavior.
_Avoid_: Temporary auto style, gate-corrected manual style

**Source-faithful rendering**:
Rendering translated text from a validated Source text style profile. Source fidelity takes precedence only when the profile passes the Source style evidence gate and remains legible against its local background; otherwise the system uses a Readable fallback style. If a validated source has no outline, no outline is introduced automatically.
_Avoid_: Forced contrast mode, always-outlined text, unvalidated source fidelity

**Nearby color profile**:
A validated source text style profile from a neighboring text region on the same page, eligible for fallback only when the regions share a compatible Text style category, the neighboring profile passes the Source style evidence gate, and the current glyph style cannot be determined confidently.
_Avoid_: Nearest pixel color, cross-category style inheritance, background fallback

**Reading view**:
The translated manga page shown on its original reading website, where the reader can compare the translation with the original image.
_Avoid_: Full editor, translation workspace

**Translation workspace**:
The full editing environment for inspecting and refining a manga page and its translation. Readers enter this workspace from the reading view when detailed editing is needed.
_Avoid_: Reading overlay, extension popup

**Inpainted clean background**:
The restored page asset produced by the inpainting pipeline, where detected text glyphs are removed and underlying manga artwork is reconstructed.
_Avoid_: Blanked background, white mask canvas

**Prepared-page prefetch**:
A later manga page whose local preparation and cleaning may complete while an earlier page is still being translated, without starting cloud translation for the later page before its normal turn.
_Avoid_: Parallel translation, translating ahead

**Adaptive cleaning scope**:
The decision between localized inpainting regions and full-page inpainting based on the distribution of the text-removal mask and the visual context required for reconstruction, while preserving the same authorized text-removal mask.
_Avoid_: Arbitrary crop, reduced mask

**Prepared-page identity**:
The content-aware identity of a locally prepared page revision. A prepared result remains reusable only while its source image revision, text-removal mask revision, and cleaning policy revision still match; translation-only settings do not change this identity.
_Avoid_: Page URL cache key, page-number cache key

**Batch progress frontier**:
The earliest page in a batch that is not yet fully ready for the user, used as the primary progress position even when a later page is being prepared concurrently.
_Avoid_: Cleaner queue position, highest started page

**Page awaiting review**:
A manga page whose local preparation exhausted its bounded quality-verification path and is withheld from automatic translation until the user reviews or explicitly retries it.
_Avoid_: Failed batch, automatically translated failure

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
