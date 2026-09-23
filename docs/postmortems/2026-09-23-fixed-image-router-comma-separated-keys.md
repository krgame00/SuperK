# Fixed image rollback rejected a comma-separated key pool

## Summary

The newly restored fixed image-routing rollback returned HTTP 400 on a real manga sample even though health-aware Auto could use the same server credentials. The fixed path passed the entire comma-separated `GEMINI_API_KEY` value to Gemini as one credential. Splitting and de-duplicating the pool before calling `requestGemini` repaired the rollback path.

## Symptom

`node .scratch/health-aware-gemini-routing/live-verify.mjs public/live_full_comparison.png` against a local server with `SUPERK_GEMINI_IMAGE_ROUTER=fixed` returned HTTP 400 in about two seconds. A Manual request for the model that had succeeded through the health-aware router also returned HTTP 400. No raw credential was printed during diagnosis.

## Root cause

`handleTranslationRequest` in `src/app/api/translate/route.ts` initially built the fixed-route key array from whole `userApiKey` and `GEMINI_API_KEY` strings. The local `.env.local` value contains multiple credentials separated by commas. `requestGemini` in `lib/server/geminiRequest.ts` expects each `apiKeys` element to be one credential and sends that element in `x-goog-api-key`. Consequently it sent the whole comma-separated string as the header value.

## Fix

The fixed branch now splits each source on commas, trims empty elements, preserves user-before-server order, and de-duplicates exact credentials. The fixed Auto model hierarchy and Manual pinning remain intact. A regression test asserts the exact effective key array.

## How it was found

The first live rollback request failed quickly; trying Manual with a model that had succeeded through the shared router also failed. This ruled out Auto ranking as the immediate cause. The shared router already split the pool, while the fixed branch did not. A focused test reproduced the wrong `apiKeys` array before the fix.

## Why it slipped through

The fixed rollback branch was reintroduced with a single-key route test. The real environment used a comma-separated multi-key value, which that test did not cover.

## Validation

The key-pool regression test passed after the fix. The same sample succeeded through fixed Manual (HTTP 200, five bubbles, 32.5s) and fixed Auto (HTTP 200, seven bubbles, 44.6s). Those checks validate the local sample and credential shape; they do not validate the user's original four failing pages.
