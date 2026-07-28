# Gemini Timeout and Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stalled Gemini requests fall through to another model within a 90-second total budget and return a useful structured error instead of `Internal Server Error`.

**Architecture:** Add one server-only request runner that owns the 30-second attempt timeout, 90-second total budget, key rotation, model fallback, and upstream error classification. Both translation routes use the runner; a small client response parser preserves structured error metadata for single-page and batch translation.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Web Fetch/AbortController APIs, React 19, Vitest 4

## Global Constraints

- Preserve image translation, text translation, multiple API keys, explicit model selection, and automatic model fallback.
- Do not change cleaning behavior, translation prompts, overlays, or model lists.
- Total request budget is 90 seconds.
- Maximum individual Gemini attempt is 30 seconds.
- Timeout/transport failure moves to the next model.
- HTTP 400/403/429 rotates to the next key for the same model.
- HTTP 500/503 retries the same model/key once, then moves to the next model.
- Explicit model selection never falls back to another model.
- Tests must not call Gemini.
- Run inline without subagents.

---

### Task 1: Build the Gemini Request Runner

**Files:**
- Create: `lib/server/geminiRequest.ts`
- Create: `tests/translation/geminiRequest.test.ts`

**Interfaces:**
- Produce:

```ts
export type GeminiErrorCode =
  | "GEMINI_TIMEOUT"
  | "GEMINI_QUOTA"
  | "GEMINI_UPSTREAM";

export class GeminiRequestError extends Error {
  readonly code: GeminiErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    code: GeminiErrorCode,
    status: number,
    retryable: boolean,
  );
}

export interface GeminiRequestResult<T> {
  data: T;
  keyIndex: number;
  model: string;
}

export interface GeminiRequestOptions {
  apiKeys: string[];
  models: string[];
  payload: unknown;
  initialKeyIndex?: number;
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function requestGemini<T = unknown>(
  options: GeminiRequestOptions,
): Promise<GeminiRequestResult<T>>;
```

- Production defaults:
  - `attemptTimeoutMs = 30_000`
  - `totalBudgetMs = 90_000`
  - `fetchImpl = globalThis.fetch`
  - `now = Date.now`
  - `sleep` uses `setTimeout`

- [ ] **Step 1: Write failing timeout/fallback tests**

Create `tests/translation/geminiRequest.test.ts` with literal fake responses
and a controlled clock. Cover:

```ts
test("transport timeout moves to the next model", async () => {
  // First fetch rejects with an AbortError; second returns a complete
  // Gemini JSON response. Assert result.model is "model-b" and that the
  // second URL contains "/models/model-b:generateContent".
});

test("429 rotates to the next API key on the same model", async () => {
  // First response is status 429 with { error: { message: "quota" } };
  // second response succeeds. Assert both URLs use model-a and the result
  // keyIndex is 1.
});

test("503 retries once before moving to the next model", async () => {
  // Two 503 responses followed by success on model-b. Assert three calls
  // and that only the third URL contains model-b.
});

test("all transport attempts return a structured timeout error", async () => {
  // Every fetch rejects with AbortError. Assert error code
  // GEMINI_TIMEOUT, status 504, retryable true, and no generic message.
});

test("one explicit model never falls back to another model", async () => {
  // Pass models: ["chosen-model"]; reject fetch. Assert one call only.
});

test("the runner never starts an attempt after the total budget", async () => {
  // Advance the injected clock to the total budget after the first
  // transport failure. Assert one call and a GEMINI_TIMEOUT error.
});
```

The fake fetch is the external boundary; assertions target returned model,
key index, call order, and structured error behavior.

- [ ] **Step 2: Run RED**

```powershell
npm test -- tests/translation/geminiRequest.test.ts
```

Expected: collection fails because `@/lib/server/geminiRequest` does not
exist.

- [ ] **Step 3: Implement the minimal runner**

Implement `requestGemini` using an `AbortController` for every attempt.
Always clear the attempt timer in `finally`. Before each attempt, compute:

```ts
const remaining = totalBudgetMs - (now() - startedAt);
const timeoutMs = Math.min(attemptTimeoutMs, remaining);
```

If `remaining <= 0`, throw `GeminiRequestError` with:

```ts
{
  code: "GEMINI_TIMEOUT",
  status: 504,
  retryable: true,
}
```

Classification rules must match Global Constraints. Store the first useful
upstream message, but prefer the timeout message only when every attempted
path ended in timeout/transport failure.

- [ ] **Step 4: Run GREEN and lint**

```powershell
npm test -- tests/translation/geminiRequest.test.ts
npx eslint lib/server/geminiRequest.ts tests/translation/geminiRequest.test.ts
```

Expected: focused tests and ESLint pass.

---

### Task 2: Route Image and Text Translation Through the Runner

**Files:**
- Modify: `src/app/api/translate/route.ts`
- Modify: `src/app/api/translate-text/route.ts`
- Create: `tests/translation/routes.test.ts`

**Interfaces:**
- Consume: `requestGemini(...)`, `GeminiRequestError`
- Produce structured failure JSON:

```ts
{
  error: string;
  code: GeminiErrorCode;
  retryable: boolean;
}
```

- [ ] **Step 1: Write failing route contract tests**

Mock only `requestGemini`, leaving each real Route Handler active:

```ts
test("image route returns 504 for Gemini timeout", async () => {
  // requestGemini rejects with GeminiRequestError(
  //   Thai timeout message, "GEMINI_TIMEOUT", 504, true
  // ).
  // POST a real Request with imageBase64 and assert status 504 plus the
  // exact code/retryable fields.
});

test("image route keeps the missing API key response", async () => {
  // Delete process.env.GEMINI_API_KEY, omit custom apiKey, POST a real
  // Request, and assert status 500 and the existing missing-key message.
});

test("text route returns 504 for Gemini timeout", async () => {
  // Set GEMINI_API_KEY, mock the runner error, POST real bubbles, and
  // assert the same structured timeout contract.
});
```

Restore the original environment in `afterEach`.

- [ ] **Step 2: Run RED**

```powershell
npm test -- tests/translation/routes.test.ts
```

Expected: timeout cases receive the old generic 500 response or the runner
mock cannot intercept because the routes do not use it.

- [ ] **Step 3: Replace inline fetch loops**

In both routes:

- Keep validation, key selection, prompt, payload, model arrays, and response
  parsing.
- Call `requestGemini`.
- In the image route, pass `initialKeyIndex: globalKeyIndex` and update the
  global index from `result.keyIndex` on success.
- Split comma-separated environment keys for both routes.
- Catch `GeminiRequestError` before the outer generic catch and return:

```ts
return NextResponse.json(
  {
    error: error.message,
    code: error.code,
    retryable: error.retryable,
  },
  { status: error.status },
);
```

- Do not log key suffixes or secret material.

- [ ] **Step 4: Run GREEN, typecheck, and lint**

```powershell
npm test -- tests/translation/geminiRequest.test.ts tests/translation/routes.test.ts
npx tsc --noEmit
npx eslint lib/server/geminiRequest.ts src/app/api/translate/route.ts src/app/api/translate-text/route.ts tests/translation
```

Expected: tests, TypeScript, and ESLint pass.

---

### Task 3: Preserve Structured Errors in the Frontend

**Files:**
- Create: `lib/translation/requestError.ts`
- Modify: `hooks/useTranslation.ts`
- Create: `tests/translation/requestError.test.ts`

**Interfaces:**
- Produce:

```ts
export class TranslationRequestError extends Error {
  readonly code?: string;
  readonly retryable: boolean;
  readonly status: number;
}

export async function readTranslationResponse<T>(
  response: Response,
): Promise<T>;
```

- [ ] **Step 1: Write failing parser tests**

```ts
test("structured timeout retains code and retryability", async () => {
  const response = Response.json(
    {
      error: "Gemini timeout",
      code: "GEMINI_TIMEOUT",
      retryable: true,
    },
    { status: 504 },
  );

  await expect(readTranslationResponse(response)).rejects.toMatchObject({
    message: "Gemini timeout",
    code: "GEMINI_TIMEOUT",
    retryable: true,
    status: 504,
  });
});

test("legacy error responses still preserve the message", async () => {
  const response = Response.json(
    { error: "legacy error" },
    { status: 500 },
  );

  await expect(readTranslationResponse(response)).rejects.toMatchObject({
    message: "legacy error",
    retryable: false,
    status: 500,
  });
});
```

- [ ] **Step 2: Run RED**

```powershell
npm test -- tests/translation/requestError.test.ts
```

Expected: module does not exist.

- [ ] **Step 3: Implement parser and use it at all four translation calls**

Implement `readTranslationResponse`, then replace each pair:

```ts
const data = await res.json();
if (!res.ok) throw new Error(data.error);
```

with:

```ts
const data = await readTranslationResponse<{ text: string }>(res);
```

Keep the existing successful parsing behavior. In batch translation, inspect
`error instanceof TranslationRequestError && error.retryable`; retryable
timeouts use the existing short retry path and must not be labeled as quota.

- [ ] **Step 4: Run GREEN and focused frontend tests**

```powershell
npm test -- tests/translation/requestError.test.ts tests/cleaning
npx tsc --noEmit
npx eslint lib/translation/requestError.ts hooks/useTranslation.ts tests/translation
```

Expected: all focused tests, TypeScript, and ESLint pass.

---

### Task 4: Verify and Commit the Reversible Fix

**Files:**
- Verify all files from Tasks 1–3

- [ ] **Step 1: Run lean final verification**

```powershell
npm test -- tests/translation tests/cleaning
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Expected: tests, typecheck, production build, and diff check pass.

- [ ] **Step 2: Restart only the worktree frontend**

Restart `npm run dev` while preserving the current injected
`GEMINI_API_KEY`. Do not restart or alter the cleaning service.

- [ ] **Step 3: Run local synthetic smoke checks**

- Synthetic valid image with a responding model returns a non-generic
  response.
- A controlled timeout test returns HTTP 504 with `GEMINI_TIMEOUT`.
- No test sends a user image to Gemini.

- [ ] **Step 4: Commit**

```powershell
git add lib/server/geminiRequest.ts lib/translation/requestError.ts hooks/useTranslation.ts src/app/api/translate/route.ts src/app/api/translate-text/route.ts tests/translation
git commit -m "fix(translation): recover from Gemini timeout"
```

Record the commit hash so the user can revert only this fix if desired.
