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

**Unconfirmed text candidate**:
A region that may contain text but lacks sufficient evidence to authorize removal or translation. It remains available for review while its original artwork is preserved.
_Avoid_: Confirmed text, automatically removable text

**Region awaiting text confirmation**:
An unconfirmed text candidate held for human review without preventing confident regions from being processed. Short glyphs, decorative lettering, and sound effects remain eligible for confirmation rather than being excluded by category.
_Avoid_: Failed page, discarded detection

**Text confirmation**:
A person's determination that a reviewed candidate contains text. It does not authorize erasing the candidate's surrounding artwork or approve its proposed removal mask.
_Avoid_: Mask approval, export confirmation

**Removal-mask approval**:
A person's acceptance of the precise pixels proposed for removal from a reviewed region after inspecting and, if needed, adjusting the mask. It is separate from confirming that the region contains text.
_Avoid_: Text confirmation, bounding-box approval

**Evidence-supported text**:
A text candidate confirmed by a primary text detector or OCR; visual hints such as dark marks on skin are supporting evidence only.
_Avoid_: Tattoo candidate, likely mark

**Text color profile**:
The separately detected fill and outline colors of a glyph. A profile is usable only when its glyph evidence is sufficiently reliable.
_Avoid_: Average crop color, foreground color

**Source text style profile**:
The visual style recovered from original glyph evidence, including fill color, outline presence, outline color and relative thickness, opacity, and any confidently detected decorative effects. Detected shadow or glow remains source evidence but does not override the Uniform translated text shadow used by automatic translated rendering.
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
A background-aware Binary Fill + Source Outline style used when source-style evidence is invalid/insufficient or when the user explicitly selects Readable. Its glyph fill is restricted to pure white or pure black, it always includes an outline, and local readability against the Inpainted clean background remains authoritative. A trustworthy Source accent color may tint the outline and may be strengthened while preserving hue when practical; a safe neutral outline is allowed when the accent cannot provide enough separation. Automatic readability may strengthen the outline or escalate to the permitted background treatment, but it does not add a stronger per-region shadow than the Uniform translated text shadow.
_Avoid_: Chromatic fallback fill, source text style profile, fixed white fallback, silent style inheritance

**Binary Fill + Source Outline**:
The current Readable policy: translated fallback glyphs use only white or black fill, while the outline carries safe source identity when possible. Light/bright Source accents prefer white fill plus Source-accent outline; dark/near-black accents prefer black fill plus white/light outline; ambiguous mid-tones and failed preferred pairs are resolved through the Readability gate. Mandatory outline applies to this Readable path, not to an admitted Source text style profile.
_Avoid_: Universal outline on validated source, arbitrary chromatic fill, hue-name classification

**Source accent color**:
A trustworthy detected source color used primarily as the thematic outline accent for Binary Fill Readable output. It may come from source fill or outline evidence and may have its lightness/value strengthened for readability while preserving hue where practical.
_Avoid_: Background crop color, mandatory exact RGB, fallback fill color

**Uniform translated text shadow**:
The single neutral dark drop-shadow treatment applied consistently and proportionally to automatically rendered translated text so one region does not gain a stronger, weaker, or missing shadow merely because its source effect detection or local readability differs. Manual style override may intentionally replace or disable it.
_Avoid_: Per-region detected shadow, readability halo, source decorative shadow

**Translated glyph footprint**:
The page area actually occupied by the laid-out translated glyphs plus the small margin needed to evaluate outline or readability separation. Binary Fill Readable decisions sample the Inpainted clean background against this footprint instead of treating the whole OCR box as the readability surface.
_Avoid_: Entire OCR box, source glyph mask, text-removal mask

**Readability gate**:
The automatic validation that decides whether a candidate text style remains legible over the actual background. It considers multiple locations across the Translated glyph footprint, including both broad contrast and weak local regions; the current behavioral target is roughly 4.5:1 across most sampled areas while avoiding materially weak local regions around 3:1 when a stronger safe candidate is available.
_Avoid_: Average crop brightness, source confidence score, Manual style enforcement

**Manual style override**:
A user-owned text style that automation may warn about but must not modify until the user explicitly returns the region to Auto or Readable behavior.
_Avoid_: Temporary auto style, gate-corrected manual style

**Source-faithful rendering**:
Rendering translated text from a validated Source text style profile while preserving the admitted source fill, outline presence, outline color/relative thickness, opacity, and other supported non-shadow styling. Detected source shadow or glow does not bypass the Uniform translated text shadow, so automatic rendering remains visually consistent across regions; a validated no-outline source may still remain no-outline.
_Avoid_: Binary fallback styling presented as source, unvalidated source fidelity, per-region source shadow preservation

**Legacy universal outline default**:
The superseded policy that automatically added a contrasting outline to all translated text lacking a detected source outline. ADR 0012 narrows this rule: Binary Fill Readable output always has an outline, while an admitted Source text style profile may preserve no-outline source styling.
_Avoid_: Current source-faithful policy, mandatory outline on validated source

**Bidirectional outline extraction**:
Text color analysis that samples both light/white and dark contour pixels around chromatic glyph cores, faithfully recovering both white-on-color outlines and dark-on-color outlines from original manga artwork.
_Avoid_: Dark-only contour bias, missed white outlines

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

**Gemini key pool**:
The active set of Gemini credentials eligible to serve a translation request. A user-provided pool and the server-provided pool are separate ownership domains rather than one implicitly mixed source of quota.
_Avoid_: Comma-separated key string, global API key

**Gemini model catalog**:
The current set of Gemini models available to the active Gemini key pool, including which credentials can reach each model and whether SuperK has verified that model for a translation workflow.
_Avoid_: Hard-coded model list, fixed fallback hierarchy

**Translation model compatibility**:
SuperK's workflow-specific knowledge that a discovered Gemini model can satisfy the contract for text translation or image/multimodal translation. An unverified model is not the same as an incompatible model, and transient quota or network failures do not change compatibility.
_Avoid_: Model availability, quota status, one global compatible flag

**Gemini model route**:
An eligible pairing of one Gemini model with one credential from the active key pool for a specific translation request. Route-level availability and cooldown are evaluated before treating an entire credential as unavailable.
_Avoid_: Global key rotation, model-only fallback

**Last-known-good translation model**:
The most recently successful compatible Gemini model remembered separately for each translation workflow and preferred by Auto when it remains eligible.
_Avoid_: Global default model, permanent pinned model

**Owned desktop child process**:
A workspace or sidecar process for which the desktop application can verify launch ownership strongly enough to reclaim it safely after an abnormal prior termination.
_Avoid_: Any process using port 3000 or 8765

**Balanced resource lifecycle**:
The policy that keeps resources needed for active translation responsive while bounding or releasing inactive page, model, and background resources so long-running sessions settle instead of growing continuously.
_Avoid_: Minimum-memory mode, unlimited warm cache, gaming mode

**Warm page set**:
The small neighborhood of manga pages intentionally kept immediately ready for navigation around the current page. The current policy treats the current page and its immediate previous and next pages as the warm page set.
_Avoid_: Whole-book preload, prepared-page prefetch

**Resource memory pressure**:
A condition indicating that SuperK should reclaim optional resident resources sooner because either its own bounded resource allowance or the host system's available memory is under pressure.
_Avoid_: Out-of-memory crash, fixed per-page limit

**Temporary processed-page cache**:
A session-scoped disk-backed copy of recomputable page artifacts used to restore an evicted page without retaining its heavy representation in memory or repeating expensive processing. It is distinct from durable project assets and is discarded when the application session ends.
_Avoid_: Project storage, prepared-page identity, permanent cache

**Idle resource mode**:
The low-activity state entered after active work is complete, in which optional model residency, hidden-window rendering, and background activity may be reduced while preserving the user's saved work and the ability to resume.
_Avoid_: Application exit, cancelled job, gaming mode

**Remembered export destination**:
The persistent local filesystem directory path configured in user preferences where exported manga archives, documents, or images are written directly without repeated save-dialog prompts.
_Avoid_: Temporary download directory, browser download default

**Direct desktop export**:
Writing exported manga assets directly to the target filesystem path via the desktop application shell's native IPC, bypassing browser download manager prompts and sandboxed web permission gates.
_Avoid_: Browser anchor click, simulated web download

**Universal outline default**:
The rendering standard ensuring that translated manga text placed over illustrations always carries a contrasting stroke by default, preventing text from blending into backgrounds of similar hues.
_Avoid_: Flat borderless text, unconditional stroke removal

**Bidirectional outline extraction**:
The color extraction technique that tests for both light/white contours around colored text cores and dark contours around light text cores, capturing the true outline style of the original manga artwork.
_Avoid_: White-core-only outline detection, unidirectional contour sampling

**Thematic subtitle pattern**:
The typesetting practice of rendering floating dialogue and sound effects over artwork with pure white fill (#FFFFFF) and a contrasting contour in the character's thematic color, maximizing readability across any illustrated background while preserving character visual identity.
_Avoid_: Solid-colored borderless text, uncontrasted floating text
