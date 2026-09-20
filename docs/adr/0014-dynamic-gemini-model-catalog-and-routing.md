# 0014. Dynamic Gemini Model Catalog and Capability-Aware Routing

Date: 2026-09-16

## Status

Accepted

## Context

SuperK previously encoded Gemini model names and fallback order in several places, including image translation, text translation, settings, and extension behavior. That made the application drift whenever Google added, renamed, restricted, or retired a model, and it could not represent the fact that different API keys may expose different models or that a model may be suitable for text translation but not image/multimodal translation.

## Decision

Use one Gemini model catalog and routing policy as the source of truth for all SuperK translation workflows. The catalog is discovered from the active Gemini key pool, merges model visibility across keys, records which credentials can serve each model, and distinguishes model availability from workflow-specific translation compatibility.

A user-provided Gemini key pool and the server-provided pool are separate ownership domains: when the user supplies keys, requests stay within that pool. Auto routing prefers stable compatible models and the workflow's last-known-good model, exhausts eligible keys for the current model before falling back to another model, and applies quota cooldown to a model+key route before escalating to key-wide unavailability. Manual model selection may rotate among eligible keys but must not silently substitute another model. Preview or experimental models are discoverable and user-selectable but are excluded from Auto unless the user opts in.

Compatibility is learned lazily from real SuperK translation requests and is tracked separately for text and image/multimodal workflows. Capability or contract failures may mark a route/model incompatible for the relevant workflow; transient quota, server, timeout, or network failures do not. Catalog metadata and bounded cooldown state may be cached across restarts using non-secret key identity, while raw API keys must not be duplicated into diagnostics or catalog metadata. A small hard-coded model list may remain only as an emergency bootstrap when discovery and cached catalog data are both unavailable.

Image translation, text translation, and the browser extension must consume the same catalog and routing semantics rather than maintaining independent fallback hierarchies.

## Consequences

- **Positive**: New or retired Gemini models no longer require normal SuperK releases merely to keep the selectable model list current.
- **Positive**: Multi-key routing preserves the selected model whenever possible and can represent different model access across credentials.
- **Positive**: Text-only and image/multimodal workflows stop sharing a misleading single compatibility state.
- **Positive**: Diagnostics can explain which model and key slot were attempted without exposing raw credentials.
- **Trade-off**: Runtime model discovery, compatibility state, cache expiry, and route cooldown become explicit application state that must be tested and persisted carefully.
- **Trade-off**: A discovered model is not automatically trusted for every SuperK workflow; first use may still reveal an incompatibility and require fallback.
