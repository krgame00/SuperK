# AI Working Notes — SuperK / Manga Translator

> **Purpose:** This file records approaches that were actually tried in this repository, what worked in the user's real workflow, what regressed, and what is intentionally paused. Future AI agents should read this before changing translation, Gemini routing, masking, or desktop packaging behavior.
>
> **Last updated:** 2026-09-17

## Current product direction

- **Primary target: Web App.** Continue treating the web version as the main product.
- **Windows Desktop / Electron / NSIS installer: PAUSED.** The desktop build was successfully produced, but the user explicitly decided to park the desktop-program direction for now. Do not spend time on Electron, portable Python runtime, or installer work unless the user explicitly asks to resume it.
- Do not delete paused desktop code just because it is not the active direction. Preserve it for possible future reuse.

## Gemini translation — current known-good baseline

### VERIFIED WORKING: fixed `requestGemini` routing for image translation

The user reported that translation stopped working after the dynamic Gemini catalog/router was placed on the live translation path. We reproduced the routing difference, restored the previous fixed-routing behavior, and the user then confirmed that translation worked again.

Current image translation path:

`hooks/useTranslation.ts` → `POST /api/translate` → `requestGemini()`

Auto uses a fixed model hierarchy and rotates API keys through `requestGemini` instead of planning routes through `GeminiCatalogManager`.

Current Auto order in `src/app/api/translate/route.ts`:

1. `gemini-3.5-flash-lite`
2. `gemini-3.8-flash`
3. `gemini-3.7-flash`
4. `gemini-3.6-flash`
5. `gemini-3-flash`
6. `gemini-3.5-flash`
7. `gemini-3.1-flash-lite`

Retry mode puts the higher-precision models first, but still uses the same fixed/direct routing mechanism.

API keys remain comma-separated internally. A user-supplied key string takes precedence over `GEMINI_API_KEY`; otherwise the server key(s) are used. The two-key fixed-routing path is covered by regression tests.

### VERIFIED WORKING: fixed routing for text translation

`POST /api/translate-text` also uses `requestGemini()` with the fixed current-model list rather than `executeGeminiTranslation()`.

### VERIFIED WORKING: direct API-key validation probe

`POST /api/translate/validate-key` currently validates through `requestGemini()` with `gemini-3.8-flash` rather than validating through dynamic `models.list` discovery.

### Verification evidence after rollback

- TypeScript: `npx tsc --noEmit` — passed.
- Focused translation/request tests — **22/22 passed**.
- Full `tests/translation` suite — **29 files / 142 tests passed**.
- Most important evidence: **the user tested the real translation workflow after rollback and confirmed it works again.**

## Gemini dynamic discovery/router — experimental, not the live translation baseline

The dynamic implementation still exists in the repository, including:

- `lib/server/geminiCatalog.ts`
- `lib/server/geminiTranslationRouter.ts`
- `/api/translate/models`
- dynamic catalog-related Settings/Extension code and tests

This work successfully demonstrated several things in isolation: `models.list` discovery, multi-key union catalog, model→key mapping, compatibility learning, cooldowns, last-known-good state, and real API discovery across multiple keys.

However, **do not re-enable `executeGeminiTranslation()` on the main image/text translation path by default.** After that architecture was enabled, the user's real manga workload stopped translating reliably. The observed UI reported four affected pages and a Google Safety Filter failure. We did **not** prove that dynamic discovery itself caused Google's safety decision, so do not write a false RCA claiming that. What is proven operationally is:

- Dynamic-routing version was active when the real workload failed.
- Fixed-routing version was restored.
- The same user workflow worked again after rollback.

Therefore the fixed route is the current production baseline.

### If dynamic routing is revisited later

Do it behind a feature flag or isolated branch first. Before replacing the fixed route, require all of the following:

- same real image workload passes end-to-end;
- Auto translation succeeds repeatedly, not just text-only probes;
- Safety-filter behavior is compared before/after with the same images;
- timeout/fallback behavior is measured;
- user-key and server-key behavior is verified;
- fixed routing remains an immediate rollback path.

Do not treat passing mocked catalog tests as sufficient evidence for replacing the known-good image path.

## Important model-routing caveats

- The dynamic Settings model catalog may still be present in the UI. **Do not assume the model catalog is the source of truth for Auto translation routing right now.** Auto translation currently uses the fixed list above.
- Manual model selection passes the selected model ID to the fixed route. Models outside the known-good fixed list are not broadly live-verified and may fail even if discovery exposes them.
- Real API experiments previously showed that a model appearing in `models.list` does not guarantee successful `generateContent` for this workload. For example, a discovered model returned 404 when actually invoked, and another model timed out. Treat discovery as availability metadata, not proof of translation compatibility.
- Keep Gemini API keys out of logs, URLs, diagnostics, and committed files.

## Safety Filter / NSFW behavior

- The app has an NSFW/Comic Slicing bypass path in `hooks/useTranslation.ts` that slices the image into a 3×2 grid and translates the six pieces.
- Do not remove or redesign this path while working on model routing unless a reproducible bug specifically points to it.
- A Google Safety Filter response is an upstream content decision. Do not automatically label the API key, model, or local cleaning pipeline as broken without reproducing and tracing the request path.

## Mask / cleaning behavior

### VERIFIED FIXED: deleting a mask must actually stop that area from being cleaned

A prior regression caused removed mask areas to remain cleaned because FORCE_CLEAN started from an already-inpainted image and merged the old mask back in.

The fix in `ocr-service/app/pipeline.py` changed the behavior so the approved/selected mask authorizes the final removal region, removed areas are restored from the source, and an empty approved mask removes nothing.

That fix was covered by backend and frontend regression tests. Do not reintroduce old-mask union behavior without a new explicit requirement.

## Desktop build history — successful but paused

The Windows installer pipeline was successfully verified before the desktop direction was paused:

- TypeScript passed.
- Full test suite at that point: **128/128 files, 764/764 tests**.
- Next.js production build passed.
- NSIS installer was generated successfully at `dist/desktop/SuperK-Windows-Setup.exe`.
- Installer was unsigned, so Windows SmartScreen could warn about an unknown publisher.

This is historical verification only. It does not mean desktop packaging should be maintained as the active product path.

## Rules for future AI agents

1. **Preserve a known-good path before replacing it.** For risky routing changes, add a feature flag or a narrow switch first.
2. **Real user workload outranks mock-only success.** A green unit test for Gemini discovery is not enough to replace translation behavior the user has confirmed works.
3. **Do not infer causality from correlation.** Record exactly what failed, what changed, and what recovered; do not invent a root cause that was not proven.
4. **Before changing Gemini routing, compare against this file and the current route implementation.** If the requested change contradicts the known-good baseline, explain the tradeoff and preserve rollback.
5. **Do not reset or discard unrelated dirty work.** This repository frequently contains multiple in-progress workstreams.
6. When a new approach is tested, update this file with one of these states: `VERIFIED WORKING`, `KNOWN REGRESSION`, `EXPERIMENTAL`, `PAUSED`, or `NOT VERIFIED`, plus the exact validation evidence.

## Text color / outline behavior — validated 2026-09-16

### VERIFIED WORKING: confidence-aware source-colored outline

The intended Auto behavior is now:

- When source-color evidence is admitted and confidence is high (>= 0.80), use the detected source accent color directly as the translated text outline.
- Medium-confidence source color may still be strengthened for readability after the evidence gate.
- Rejected/weak candidates (including background contamination or insufficient evidence) must not leak back into the outline color; fall back to a safe dark outline instead.
- Manual styling remains authoritative.

Verification evidence:

- `tests/colorMatching`: **26 files / 194 tests passed**.
- `npx tsc --noEmit`: passed.

This specifically prevents a color sampled from panel/background artwork from being reused as the translated outline after the evidence gate rejected that sample.

## Translated text shadow behavior — validated 2026-09-17

### VERIFIED WORKING: uniform proportional shadow across render surfaces

ADR 0015 is the current rendering contract for translated-text shadow behavior:

- Auto, Auto → Readable fallback, explicit Readable, Source-faithful, and ordinary dialogue all render the same Standard Shadow: `#1e1e1e`, opacity `0.80`, blur ratio `0.15`, offset-X/Y ratio `0.08`, scaled by rendered font size.
- Detected source `shadow`, `glow`, and legacy `readabilityHalo` remain source/profile evidence but do not control automatic final rendering.
- Automatic readability no longer adds a per-bubble halo; readability escalation must not make one region look more shadowed than another.
- Source-colored outline remains independent from the neutral Standard Shadow.
- Manual text defaults to Standard Shadow and may explicitly select `Off`; changing other Manual style properties does not implicitly toggle shadow.
- Legacy project metadata is preserved rather than destructively migrated.
- Web canvas preview/export and Chrome Extension overlays consume equivalent Standard Shadow semantics. Cached Extension overlays are re-rendered through the same current rule.

Verification evidence:

- Focused Uniform Shadow / overlay / Extension regression set: **60/60 passed**, followed by cached/restored Extension + ownership persistence **12/12 passed**.
- Full Vitest suite: **133/133 files, 794/794 tests passed**.
- `npx tsc --noEmit`: passed after the final implementation changes.
- Source-effect sampling coverage remains green, so source shadow/glow evidence extraction was not removed.

### VERIFIED WORKING: authentic monochrome manga text style (ADR 0016)

ADR 0016 introduces a narrow exception to ADR 0015 specifically for confirmed monochrome manga pages:

- Page-level classifier (`analyzeMonochromePage` / `analyzeImageElementMonochrome`) evaluates the pre-clean original source image once per page using deterministic grid subsampling (up to ~20,000 samples).
- When `isMonochromePage === true` and `monochromeConfidence >= 0.85`:
  - White/light speech balloons (`backgroundLuminance >= 155`): render crisp black text (`#000000`) without an automatic shadow (`shadow = undefined`), defaulting to `hasOutline = false`.
  - Black/dark speech bubbles (`backgroundLuminance <= 100`): render crisp white text (`#ffffff`) without an automatic shadow (`shadow = undefined`).
  - Mixed/intermediate backgrounds: use contrasting outline for readability, but suppress automatic shadow.
- Manual user styling (`ownershipMode === 'manual'`) retains absolute authority; Manual Standard keeps standard shadow and Manual Off has no shadow.
- Color pages, low-confidence pages, and unconfirmed pages retain ADR 0015 Uniform Shadow.
- Full parity across Web Preview Canvas, Image Export, Extension Server Mode, Extension Direct Mode, and restored Chrome local-storage caches.

## Quick status summary

- **Web App:** ACTIVE / primary direction.
- **Fixed Gemini `requestGemini` routing:** VERIFIED WORKING / current baseline.
- **Dynamic Gemini catalog/router on live translation path:** KNOWN REGRESSION in the user's real workflow; keep experimental until revalidated.
- **Dynamic catalog/discovery infrastructure itself:** EXPERIMENTAL but technically useful; not the production routing authority.
- **NSFW 3×2 slicing:** ACTIVE; do not blame/remove without repro evidence.
- **Mask deletion authorization fix:** VERIFIED WORKING.
- **Windows Desktop/Installer:** PAUSED by user decision.
