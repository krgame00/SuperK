# Gemini Timeout and Fallback Design

## Goal

Prevent a single stalled Gemini request from waiting five minutes, bypassing
the existing key/model fallback, and surfacing `Internal Server Error`.

## Scope

- Preserve image translation, text translation, multiple API keys, explicit
  model selection, and automatic model fallback.
- Change only Gemini request execution and translation error reporting.
- Do not change cleaning behavior, translation prompts, overlays, or models.
- Keep the change isolated on `codex/superk-hybrid-cleaning` so it can be
  reverted independently.

## Architecture

Create one server-only Gemini request helper used by both translation route
handlers. The helper owns per-attempt timeout, total request budget, retry
classification, API-key rotation, model fallback, and structured failure
results. Route handlers continue to own request validation, prompt creation,
and Gemini response parsing.

## Time Budget

- Total budget per translation request: 90 seconds.
- Maximum per Gemini attempt: 30 seconds or the remaining total budget,
  whichever is smaller.
- A successful response stops all fallback immediately.
- The helper must never start an attempt after the total budget is exhausted.

## Fallback Policy

- Timeout, connection reset, or transport failure: move to the next model.
  Trying another key for the same transport failure is not useful.
- HTTP 400, 403, or 429: move to the next API key for the same model.
- HTTP 500 or 503: retry the same model/key once after a short delay, then
  move to the next model.
- Other non-success HTTP responses: move to the next model.
- When the user explicitly selects a model, do not fall back to a different
  model, but API-key rotation remains available.
- Preserve the existing working-key index after a successful request.

## Error Contract

Translation routes return structured JSON failures:

```json
{
  "error": "Gemini ตอบสนองช้าเกินกำหนด กรุณาลองใหม่หรือเปลี่ยนโมเดล",
  "code": "GEMINI_TIMEOUT",
  "retryable": true
}
```

- Exhausted timeout/transport attempts use HTTP 504.
- HTTP failures keep the most useful upstream status and message when
  available.
- Missing API key and invalid request behavior remain unchanged.
- Gemini timeout must never become the generic `Internal Server Error`.

## Frontend Behavior

`useTranslation` reads the structured `code` and `retryable` fields while
continuing to support older `{ error }` responses. Single-page translation
shows the server message. Batch translation retries only retryable failures
and must not classify a timeout as quota exhaustion.

## Testing

Tests use injected fake fetch and fake time; they never call Gemini.

Required cases:

- First model times out and the next model succeeds.
- First API key returns 429 and the next key succeeds.
- HTTP 500/503 retries once, then falls back.
- All attempts time out and return a structured 504 failure.
- Explicit model selection never falls back to another model.
- Missing API key behavior remains unchanged.
- Frontend parsing preserves the structured error code and retryability.

Focused TypeScript tests, type checking, and production build are sufficient.
The cleaning benchmark does not need to run because cleaning code is outside
this change.
