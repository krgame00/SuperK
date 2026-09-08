# 02: Structured Translation Error Taxonomy & API Contract

**What to build:** The translation pipeline classifies every translation failure into one of five canonical error categories (`MISSING_KEY`, `QUOTA_EXHAUSTED`, `SAFETY_BLOCKED`, `LOCAL_SIDECAR_OFFLINE`, `NETWORK_OR_TIMEOUT`) instead of collapsing them into vague error strings. The translation API returns structured error codes and descriptive Thai explanations that empower the frontend to know the exact root cause of every failed page.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `/api/translate` returns structured JSON with an error `code`, `title`, and `message` when encountering authentication, quota, safety, or network errors
- [ ] Upstream Google Gemini safety blocks (prompt feedback blockReason or candidate finishReason SAFETY) are explicitly flagged with `SAFETY_BLOCKED`
- [ ] 429 rate limit errors across all fallback models are categorized with `QUOTA_EXHAUSTED` and preserve wait cooldown metadata
- [ ] Missing API key (HTTP 500/401) is explicitly tagged with `MISSING_KEY`
- [ ] Local Python sidecar unavailability during preparation is caught and tagged with `LOCAL_SIDECAR_OFFLINE`
- [ ] Hook `useTranslation` collects granular failure descriptors for each failed page in `batchFailures`
- [ ] Unit tests assert correct error classification across all five taxonomy branches
