# Clean-Then-Translate Workflow Design

- **Date:** 2026-07-28
- **Status:** Approved design; awaiting written-spec review
- **Target:** SuperK local web upload workflow
- **Selected approach:** Clean one page, translate that clean page, then continue

## 1. Problem

SuperK currently exposes cleaning and translation as separate actions. Pressing
`Translate` or `Translate All` sends the original page to translation even when
the page has not been cleaned. This makes the normal workflow require extra
manual steps and can place translated text over the original text.

The desired experience is a single translation command similar to modern manga
translation tools: cleaning remains available for manual correction, but it is
also an automatic prerequisite of translation.

## 2. Goals

- Make `Translate this page` run cleaning before translation.
- Make `Translate all` run the same clean-then-translate pipeline one page at a
  time.
- Reuse a valid in-session cleaning result instead of cleaning the page again.
- Translate the clean image while keeping the original page URL as the stable
  project identity.
- Show whether the active operation is cleaning or translating.
- Keep the existing cleaning toolbar and Mask Editor as advanced repair tools.
- Let the user switch among Original, Clean, and Translated after translation.
- Isolate failures to one page during a batch and summarize pages that require
  another attempt.

## 3. Non-goals

- Do not automatically translate merely because the user scrolls to a page.
- Do not clean every page before starting any translation.
- Do not remove the manual cleaning controls.
- Do not change detector, eligibility, SFX-preservation, inpainting, translation
  prompt, model selection, or Gemini fallback behavior.
- Do not persist temporary object URLs across browser sessions.
- Do not silently translate the original image when cleaning fails.
- Do not run multiple cleaning or translation jobs concurrently in this phase.

## 4. User Workflow

### 4.1 Translate this page

1. The user presses `Translate this page`.
2. SuperK checks for a valid cleaning result keyed by the original page URL.
3. If one exists, SuperK reuses its clean image.
4. Otherwise, SuperK fetches the original page, submits it to the cleaning
   service, waits for completion, and hydrates the clean result.
5. SuperK sends the clean image to the translation endpoint.
6. SuperK applies the translated bubbles to the clean page.
7. The translated result becomes the visible layer immediately.

If cleaning fails, translation does not start. The page remains unchanged and
the UI shows the existing cleaning recovery action.

### 4.2 Translate all

For each page in project order:

1. Reuse or create the cleaning result.
2. Translate the resulting clean image.
3. Cache the translated bubbles and final rendered image under the original
   page URL.
4. Continue to the next page.

A page-level cleaning or translation failure is recorded and the batch
continues with the next page. At the end, the UI reports successful pages and
lists failed page numbers with a retry action.

Cancellation stops after the currently awaited request returns or is cancelled
by its existing mechanism. No new page starts after cancellation.

## 5. Architecture

Keep cleaning and translation as separate domain hooks and add a narrow
orchestration contract between them.

### 5.1 Cleaning contract

Extend the cleaning hook with an explicit page operation:

```ts
cleanPage(pageUrl: string, source: Blob): Promise<PageCleaningResult>
```

The operation:

- returns an existing valid result immediately,
- starts and tracks a cleaning job for the requested page when needed,
- stores the hydrated result in `resultsByPage`,
- returns the hydrated result to the caller,
- records the existing structured cleaning error and rethrows failures so the
  workflow can stop or skip that page,
- does not depend on `currentPage` remaining selected while a batch is running.

`cleanCurrentPage` remains as a convenience wrapper for the manual toolbar.

Cleaning jobs and result maps continue to use the original page URL as their
key. Clean object URLs are derived artifacts, never page identities.

### 5.2 Translation preparation contract

The page component provides the translation hook with:

```ts
preparePageForTranslation(
  pageUrl: string,
  pageIndex: number,
): Promise<string>
```

The callback fetches the original image when cleaning is required, calls
`cleanPage`, and returns `PageCleaningResult.cleanUrl`.

The translation hook calls this callback immediately before
`performTranslation`. `performTranslation` receives two identities:

- the prepared clean URL used to load pixels and send the image to the API,
- the original page URL used for active-page checks, bubble caches, translated
  image caches, session persistence, and page navigation.

This prevents temporary clean URLs from breaking restored sessions or creating
duplicate page cache entries.

### 5.3 Batch coordinator

`handleTranslateAll` remains the owner of page order, retry policy, cancellation,
and total progress. For every page, it runs preparation once before translation.

- Cleaning failures are not retried by the Gemini retry loop.
- Translation retries reuse the same prepared clean URL; they do not clean the
  page again.
- A failed page is appended to a batch failure list.
- Progress advances to the next page after the failure is recorded.

## 6. State and UI

Use one workflow phase for the user-facing operation:

```ts
type TranslationWorkflowPhase =
  | "cleaning"
  | "translating"
  | "waiting"
  | "cooldown";
```

Required status copy:

- `กำลังคลีนหน้า 2/10`
- `กำลังแปลหน้า 2/10`

For a single page, the denominator may be omitted when it improves readability,
but the phase must remain explicit.

The existing top progress indicator and batch progress card remain the primary
feedback surfaces. Do not add another persistent panel. The translate buttons
stay disabled while their workflow is active, and their loading labels reflect
the current phase.

After success, the canvas defaults to `Translated`. The existing cleaning layer
controls are extended or grouped so the user can select:

- `Original`
- `Clean`
- `Translated`

Mask, eligibility, review, protected, and diff layers remain available under
the advanced cleaning controls and are not promoted into the normal translation
path.

## 7. Cache and Invalidation

- A result in `resultsByPage` is the authoritative in-session clean cache.
- Restored cleaning metadata may hydrate a result before reuse.
- A manual region retry, Force Clean, or Protect action replaces the clean
  result for that original page.
- Replacing a clean result invalidates that page's translated bubbles and final
  rendered image because they were calculated from older clean pixels.
- Removing or replacing an uploaded page removes or ignores its old derived
  results through the existing project identity rules.
- Translation retries within the same operation reuse the prepared clean image.

## 8. Error Behavior

### Single-page command

- Cleaning failure: stop; do not call the translation endpoint.
- Translation failure: keep the clean result visible and show the structured
  translation error.
- The user can retry without paying the cleaning cost again.

### Batch command

- Cleaning failure: record the page, skip translation for that page, continue.
- Non-retryable translation failure: record the page and continue.
- Retryable translation failure: apply the existing bounded retry policy; record
  the page only after retries are exhausted.
- Completion message reports success count and failed page numbers.
- Failed pages remain individually retryable using `Translate this page`.

No failure path silently falls back to translating original pixels.

## 9. Testing

### Cleaning hook

- Returns a cached page result without creating a new job.
- Returns the newly hydrated result after a successful job.
- Supports a non-current page during batch execution.
- Records and rethrows cleaning failures.
- Manual `cleanCurrentPage` continues to work.

### Translation hook

- Single-page translation waits for preparation and sends the prepared URL.
- Cleaning/preparation failure prevents the translation request.
- Batch processing prepares and translates pages in project order.
- Translation retries reuse one prepared clean result.
- Batch processing continues after a page-level cleaning failure.
- Cancellation prevents the next page from starting.
- Caches remain keyed by the original page URL.

### Page integration

- `Translate this page` performs clean then translate.
- `Translate all` displays distinct cleaning and translating phases.
- An existing clean result skips cleaning.
- Successful translation selects the Translated layer.
- Original, Clean, and Translated layers remain selectable.
- Manual re-cleaning invalidates stale translation output.
- Batch completion summarizes failed page numbers.

### Verification

Run focused hook and component tests, TypeScript checks, scoped lint, and a
production build. A local smoke test should cover one page with no prior clean
cache and one page with an existing clean result. The ten-page cleaning
benchmark does not need to run because detector and cleaner behavior are
unchanged.

## 10. Acceptance Criteria

- Both translation buttons always prepare a clean image first.
- The translation API receives clean pixels, never original pixels after a
  cleaning failure.
- Cached clean results are reused.
- Batch order is clean page, translate page, then next page.
- Progress distinguishes cleaning from translation.
- A single-page cleaning failure blocks translation.
- A batch page failure does not block later pages.
- Batch completion identifies failed pages.
- Existing manual cleaning and Mask Editor behavior remains available.
- The user can switch between Original, Clean, and Translated.
- Existing translation retry, API-key, model, and timeout behavior remains
  intact.
