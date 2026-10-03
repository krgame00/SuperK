# Foreign-script guard — verification and bug record

## Failure and cause

The reported text `กลิ่นนี่มันมีมนמהขลังอะไรกันแน่...` contains two Hebrew letters. The original detector returned zero because its four block patterns covered only kana/Han/Cyrillic/Hangul. A kana control returned five, while plain Thai/Latin returned zero. The failure is in translation data, not canvas/font rendering.

The image translation retry relied on that count, so Hebrew never triggered it. Quality review also trusted a provider's `ok` or `suggested` response without a local script check. A saved editor could therefore offer a contaminated replacement or fail to show contamination when its existing clean review snapshot was stale.

## Changes

- Detector uses Letter/Mark categories and Unicode Script_Extensions to distinguish Thai/Latin/shared inherited marks from foreign lettering, including supplementary Han and Arabic-specific inherited marks. Numbers, punctuation, symbols and neutral emoji marks are allowed. Existing count/scan/report seams reuse it; deleted text is excluded and legacy `translated` fields supported.
- Existing normal-image retry remains bounded to one, preserving the cleaner output. The slice/OCR path retains its existing retry behavior, but final review/warnings inspect it too. Newly recovered translations are included in final warnings.
- Target-aware local review guard overrides false approval, discards contaminated suggestions, preserves clean suggestions for explicit acceptance, and works when source/provider is unavailable. API, client and saved editor share it.
- Editor scans actual current text independently when saved review metadata is stale, preserving saved text/layout and snapshot restrictions. It disables unsafe acceptance and shows offending letters.
- Whole-book scan respects the target language. Final page warning identifies affected point numbers and characters. Review prompt asks for source-backed word replacement and preserves permitted Latin names/SFX.

## Evidence

- RED/GREEN: Hebrew and extended Unicode fixtures, false provider approval, contaminated replacement, unavailable-review fallback, API output guard, unresolved retry warning, saved editor without/with stale metadata, Unicode numeric/punctuation false positives, and Arabic-specific inherited marks.
- Final focused run: **7 files, 178 tests passed**, exit 0, including translationOverlay, scriptGuard, review client/API, Unicode detector and export review gate.
- Full regression run before the final review corrections: **176 files and 1,387 tests passed; one test/file skipped**, exit 0. Final corrections were verified in the focused suite rather than claiming this earlier full run covered later changes.
- TypeScript `tsc --noEmit`: exit 0 after the saved-editor/category corrections.
- ESLint changed files: exit 0, four warnings in useTranslation. Running ESLint against the baseline version of that file confirms the same four pre-existing warnings.
- Two independent code-review axes against baseline `a0d21c154e0a19ea76e140d1fd4bdd864b26cbf0`. Fixed the reported stale-snapshot, numeric false-positive and inherited Arabic-mark issues; rechecks found no remaining actionable findings.
- Tests used mocked provider responses; no real manga or user API key was sent to translation providers. No dependency or project schema was changed.

## Release

User confirmed saved work and authorized the update. Production build passed compilation, TypeScript and static generation (17/17). Standalone assets synced; audit checked 1,277 JS/JSON files with zero corrupt files. Owned web runtime restarted successfully. Independent live checks returned HTTP 200 for web and OCR health, confirmed build ID `fWgNmlxQHG-y0675UTXX-` in served HTML, and loaded all nine referenced JavaScript assets successfully. Web PID 18016; OCR PID 13256. Web error log was empty.

## Limits

Permitted Latin lettering remains allowed at the script layer; its semantic use still requires the source-backed quality review. Existing saved translations are flagged and remain editable; they are not silently rewritten. A model retry or quality-review suggestion is not a guarantee of correct meaning.
