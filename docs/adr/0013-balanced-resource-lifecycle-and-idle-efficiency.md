# 0013. Balanced Resource Lifecycle and Idle Efficiency

Date: 2026-09-15

## Status

Accepted — amends the close/tray behavior in ADR 0003 and the earlier unconditional close-to-tray desktop behavior; preserves ADR 0005's bounded prepared-page prefetch and durable prepared-result semantics

## Context

SuperK is a long-running Windows desktop application that combines an Electron workspace, a local workspace server, and a Python sidecar hosting OCR and inpainting models. Real usage showed that leaving the application open for long periods could retain substantially more memory and GPU state than the user expected, especially after opening many manga pages or using local AI work. The application could also remain fully resident after its main window was closed because the close action hid the workspace to the System Tray.

The problem is not a single requirement to minimize memory at all times. Active OCR, cleaning, translation, and page navigation legitimately need resources. The architectural requirement is instead that inactive resources are bounded and reclaimable, that long sessions converge toward a stable working set rather than growing approximately with every page ever opened, and that hidden idle operation does not compete unnecessarily with other desktop work.

There is a real trade-off. Keeping every decoded page, processed image, and neural model warm maximizes immediate responsiveness but steadily consumes RAM/VRAM. Aggressively releasing everything minimizes residency but forces expensive reload or recomputation on routine navigation. The chosen policy therefore favors balanced responsiveness with measurable bounds.

## Decision

1. **Use a Balanced resource lifecycle.**
   Resources needed for active work remain available, while inactive page representations, caches, hidden-window activity, and heavy model residency are bounded and reclaimable. The system optimizes for a stable long-running session rather than either minimum possible memory or maximum warm-cache speed.

2. **Keep only a small Warm page set resident by preference.**
   The current page plus its immediate previous and next pages form the preferred warm navigation neighborhood. Other page representations are eligible for eviction under the cache policy. The Warm page set is distinct from Prepared-page prefetch: ADR 0005 may still prepare only page N+1 while page N is being translated.

3. **Use bounded adaptive page caches.**
   In-memory original/decoded, cleaned, mask, translated-render, and related recomputable page representations must be governed by recency plus a resource budget rather than growing with every page visited. The target budget adapts to the host machine, initially around 5–8% of system RAM with explicit minimum/maximum caps. Eviction may occur earlier under Resource memory pressure.

4. **Prefer lazy/file-backed source-page access.**
   Whole books must not require all full-resolution source pages to remain as Base64/Data URLs in application state. Pages are loaded/decode-ready when needed around the Warm page set and active work frontier.

5. **Spill evicted recomputable results to a Temporary processed-page cache when useful.**
   Expensive processed page results may be kept on session-scoped disk storage so revisiting an evicted page does not require repeating OCR/cleaning solely because its heavy in-memory representation was reclaimed. This ephemeral cache is cleared when the application session ends.

6. **Do not confuse resource eviction with project durability.**
   Evicting an in-memory or Temporary processed-page cache representation must never delete confirmed translations, user edits, durable project assets, or a valid Prepared-page result governed by Prepared-page identity. ADR 0005's content-aware durable prepared-result reuse remains in force. Resource reclamation only removes representations that can be restored from durable state or safely recomputed.

7. **Unload heavy local AI residency adaptively.**
   OCR/inpainting model residency may remain warm during active use. When the queue is empty, the normal idle target is about five minutes before releasing optional heavy model state; Resource memory pressure may trigger earlier release. A subsequent request may reload the model, with roughly 3–5 seconds of cold-reload latency accepted as the trade-off for lower idle RAM/VRAM.

8. **Finish active work before entering Idle resource mode.**
   Hiding or minimizing the application does not cancel a user-requested OCR/cleaning/translation operation already in progress. The active operation may complete safely. Once the work queue is empty, the application enters Idle resource mode and reduces optional hidden-window rendering, timers, prefetch, and heavy model residency according to the resource policy.

9. **Throttle hidden idle UI/background activity.**
   The desktop workspace should use platform/background throttling when hidden and idle, and recurring timers must have explicit lifecycle cleanup. Background activity needed for an active job may remain available until that job finishes; idle hidden operation should not behave like a foreground rendering workload.

10. **Make close behavior explicit and remembered.**
    The first close-button interaction asks whether closing the window should Exit SuperK or Minimize to Tray, and remembers that preference. Minimize to Tray remains supported. A true Exit must perform managed shutdown of all Owned desktop child processes and leave no SuperK-owned Electron, workspace-server, Python sidecar, or heavy-worker process orphaned after shutdown settles.

11. **Use memory pressure from both SuperK and the host system.**
    Reclamation decisions consider both the application's own bounded cache/resource allowance and system-level memory pressure. A system usage level around 80% is an initial pressure signal rather than a public compatibility guarantee; exact implementation thresholds remain calibratable.

12. **Measure lifecycle performance with a repeatable before/after benchmark.**
    The accepted scenario is: cold start → settle idle → visit pages 1, 20, 50, and 100 → return to page 1 → run OCR/translation → idle 5 minutes → hide to Tray 5 minutes → restore → Exit. Each candidate is run three times and evaluated by median using the same machine, book/input set, runtime, and configuration.

13. **Use plateau-oriented acceptance instead of one universal RAM ceiling.**
    After warm-up, total SuperK memory between approximately page 50 and page 100 should grow by no more than about 20% for the accepted benchmark workload. Idle CPU should average no more than about 2% over a 60-second settled interval. Hidden/idle GPU utilization should be near 0% when there is no GPU-heavy job. Heavy model VRAM should be releasable under the idle policy. These are behavioral release targets, not guarantees that every machine uses the same absolute number of megabytes.

14. **Fix runaway lifecycle timers as correctness defects.**
    Recurring cooldown/polling work must stop when its owning state expires or is disposed. The known short-period cooldown timer is treated as a correctness regression and does not require a separate user-facing resource mode.

15. **Gaming Mode is deferred.**
    Resource lifecycle, cache bounds, model unloading, and background idling must be correct before adding a separate Gaming Mode. Gaming-specific process priority, thread limits, or GPU scheduling are a later policy built on top of this lifecycle foundation.

## Consequences

- Long-running sessions should converge toward a bounded working set instead of retaining every page representation visited during the session.
- Revisiting an old page can incur disk-read/decode latency, while a page missing from both memory and temporary cache may require safe recomputation.
- Heavy OCR/inpainting models may require a 3–5 second reload after idle reclamation, trading immediate first-operation latency for lower idle RAM/VRAM.
- Tray operation remains available, but closing the window is no longer silently equivalent to keeping every service resident; the user's remembered close preference becomes authoritative.
- Active work remains reliable when the window is hidden because idling begins after the current queue drains rather than force-cancelling neural work.
- Cache implementation becomes more complex because it must distinguish durable project/prepared assets from ephemeral decoded/rendered representations.
- Performance verification must report RAM, CPU, GPU/VRAM, latency, and process lifecycle together; lowering one metric by silently degrading correctness, losing saved work, or repeating unnecessary heavy processing is not an acceptable optimization.
- ADR 0005's one-page-ahead preparation and Prepared-page identity remain unchanged. This ADR constrains residency and lifecycle around those semantics rather than replacing them.
