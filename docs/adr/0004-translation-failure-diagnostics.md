# 0004. Granular Translation Failure Diagnostics and Automatic Environment Forwarding

Date: 2026-09-09

## Status

Accepted

## Context

When users run batch translation across multiple manga pages and all or some pages fail, the user interface previously reported a generic summary:
`⚠️ แปลเสร็จ แต่หน้า 1, 2, 3... ต้องลองใหม่`

This generic message provided no diagnostic insight into *why* the pages failed (e.g., missing API key, rate limit 429 quota exhaustion, safety filter/NSFW blocks, or offline sidecar services). Furthermore, in the standalone desktop environment, Next.js standalone process was spawned without explicit inheritance or parsing of local `.env.local` files, leading to a silent missing API key state even when the user already had valid keys configured in `.env.local` on disk.

## Decision

1. **Structured Failure Classification (Taxonomy)**:
   Classify all translation failures into a canonical diagnostic taxonomy:
   - `MISSING_KEY`: No API key available on server or client.
   - `QUOTA_EXHAUSTED`: Upstream 429 rate limit or quota exceeded across all available model fallbacks.
   - `SAFETY_BLOCKED`: Gemini safety filters rejected the prompt/image (promptFeedback blockReason or candidate finishReason SAFETY).
   - `LOCAL_SIDECAR_OFFLINE`: Port 8765 cleaning engine unreachable or failed during page preparation.
   - `NETWORK_OR_TIMEOUT`: Loopback or upstream connection timeout or network abort.

2. **Error Diagnostic Modal & Action Matrix**:
   Instead of a simple generic toast, translation errors produce a diagnostic error modal and per-page visual status badges on the filmstrip:
   - Displays clear human-readable Thai explanations of the exact root cause.
   - Provides direct, contextual action buttons:
     - `MISSING_KEY` ➔ One-click open Settings modal focused on API Key input.
     - `QUOTA_EXHAUSTED` ➔ Retry failed pages countdown / add fallback keys suggestion.
     - `SAFETY_BLOCKED` ➔ Toggle Comic Slicing / NSFW Bypass mode and retry.
     - `LOCAL_SIDECAR_OFFLINE` ➔ Restart cleaner service trigger.

3. **Desktop Environment Auto-Forwarding**:
   The Electron Main Process and `WorkspaceServerSupervisor` read and forward `.env.local` / `.env` variables directly into the child process environment upon launch, eliminating manual configuration when keys already exist on disk.

## Consequences

- **Positive**: Eliminates user confusion when batch translation halts; delivers clear actionable steps to unblock translation; automatically resolves API keys from existing environment files in desktop mode; preserves high-level batch UX while exposing granular debugging details on demand.
- **Trade-offs**: Introduces diagnostic modal UI state and per-page error badge tracking in the translation workspace.
