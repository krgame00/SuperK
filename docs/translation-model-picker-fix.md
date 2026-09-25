# Translation model picker fix — 2026-09-25

Status: IN PROGRESS

## Reproduction and root cause

The live `/api/translate/models` response reported 32 `ready` models for the active key pool, including TTS, image generation, transcription, and specialist models. Settings offered them because it filtered only `availabilityCount > 0` and image compatibility other than `incompatible`. Discovery means that a key can list a `generateContent` model; it does not prove that the model can return the text JSON required by image translation. The production image path uses the fixed model list in `/api/translate`.

## Implementation plan

1. Add a failing Settings test showing that an unrelated discoverable model cannot be selected, while a fixed image translation model can.
2. Share the existing fixed image model list with Settings without changing Auto order. Filter Manual options by that list and current route health. Treat bootstrap or stale discovery as unverified, so only Auto remains selectable.
3. Update existing picker tests for the production model set and verify focused tests, TypeScript, and a read-only live catalog check.
4. Record outcome and limitations in this plan and `docs/AI-WORKING-NOTES.md`.

## Limits

`models.list` and health state cannot guarantee that a request will succeed later; quotas and Google capacity can change between selection and translation. Manual options are eligible models, not a promise of current provider capacity.
