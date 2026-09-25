# Translation latency investigation plan — 2026-09-24

Status: **DIAGNOSED FOR THE OBSERVED WINDOW / NOT FIXED**

1. [x] Establish a direct, repeatable API probe with a real manga sample.
2. [x] Confirm active image router and key-pool configuration without exposing credentials.
3. [x] Compare two runs on the same image to identify where latency occurs.
4. [x] With the user's explicit authorization, capture direct provider status and duration by numbered key without logging credentials or image content. The earlier unapproved attempt was rejected by automatic review.
5. [x] Compare provider behavior with app latency. The primary model timed out on both image and text probes, while fallback models returned 503/429 or also timed out.
6. [x] Fix the separate timeout key-skip defect with a failing test: a transport timeout now advances to another key on the same Flash Lite model before changing models. The same image completed twice afterward, though not faster than the user's target.
7. [ ] Achieve and validate the user's 20–30 second target when provider capacity permits; do not claim this from a route-selection test alone.

Evidence: `public/comparison/compare_page_34.jpg` through the running app returned HTTP 200 in 62,195 ms (6 attempts, 2 fallbacks) and 46,737 ms (4 attempts, 1 fallback), then HTTP 504 `GEMINI_TIMEOUT` in 90,068 ms. The user reports a normal baseline of 20–30 seconds or faster. The app and OCR health endpoints both returned HTTP 200. Fixed image routing is configured. Focused translation tests passed 39/39 and TypeScript passed using local binaries. No code fix has been validated.

Direct provider snapshot: `gemini-3.5-flash-lite` timed out on image (25 seconds) and text (10 seconds) for key slots 1–4. `gemini-3.1-flash-lite` returned 503 on slots 1–4; `gemini-3.8-flash` returned 429 on slots 1–4. First-key checks: 3.7 Flash and 3.6 Flash returned 429, 3 Flash returned 404, 3.5 Flash timed out. A no-key POST returned 403 in 156 ms, so the endpoint itself was reachable. Probe traffic was parallel; provider state can change over time.

Additional key check: slots 5–8 also returned 503 on 3.1 Flash-Lite and 429 on 3.8 Flash. On primary 3.5 Flash-Lite, slot 5 returned 503 and slots 6–8 timed out at 10 seconds for text-only requests. This disproved the idea that the current two-429 fast-skip hid a healthy key for 3.8 Flash in this snapshot. No healthy route was found among the first three Auto models and all eight keys.

Documentation follow-up: confirm how the eight keys map to Google Cloud projects in AI Studio; quota is per project, not per key. Check each key's Key Type for September 2026 Standard-key migration, and the affected project's Usage and Rate Limit dashboards to identify RPM, TPM, or RPD. The fixed fallback ID `gemini-3-flash` returned 404 and is absent from Google's current model list; handle it as a separate code cleanup only after the active latency diagnosis is complete.

User-supplied monthly peak table for one selected project: 3.5 Flash-Lite is 7/15 RPM, 7.74K/250K TPM, 131/500 RPD; 3.1 Flash-Lite is 8/15 RPM, 4.62K/250K TPM, 41/500 RPD. These are below their limits in that project. Flash fallbacks 3.8, 3.7, and 3.6 reached or exceeded their displayed 20 RPD ceiling during the month. The user confirmed the eight keys span multiple projects, so inspect each project's Usage view for today's live usage and map key slots to projects before attributing a specific 429 to a specific quota.

Clarification: key slots 5–8 all share the project whose monthly peak table the user supplied. They share one RPM/TPM/RPD bucket, so cycling these four keys does not multiply quota. Their Lite-model 503/timeouts occurred despite the displayed monthly peaks being below the listed Lite quotas; the Flash-model 429s align with the shared project's reached/exceeded 20 RPD historical peak, but current daily usage must be checked to establish the exact quota window. Key-to-project mapping for slots 1–4 remains open.

Timeout key rotation regression: new test failed before the implementation because the first timeout jumped from 3.5 Flash-Lite to 3.1 Flash-Lite; after the fix, 40/40 focused tests and TypeScript passed. Two same-image live runs returned HTTP 200 on 3.5 Flash-Lite in 45,190 ms and 46,770 ms, with two attempts/one fallback each. The fix preserves model preference but does not yet meet the 20–30 second latency target.

Independent review found that the existing two-429 fast-skip ignored project boundaries. A revised failing test showed it skipped a third key that could succeed on the same model. Removed that heuristic; the fixed route now rotates through available keys on 429. Full translation tests passed 180/180 and TypeScript passed. No separate live benchmark was run for this second change; the prior provider snapshot had 429 on all eight keys for 3.8 Flash.
