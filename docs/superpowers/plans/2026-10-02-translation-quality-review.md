# Translation quality review

Approved: compare each page's translations to their captured source before drawing. Preserve translations until the user chooses a suggestion. Do not remove individual Thai consonants or guess missing source text.

## Contracts

- `lib/translation/qualityReview.ts`: `TranslationReview` snapshots source and reviewed text, status (`ok`, `suggested`, `needs_review`, `accepted`, `dismissed`, `unavailable`, `stale`), optional suggestion/reason/originalTranslation.
- Request `/api/translation-review`: `{items:[{id,sourceText,translatedText}],targetLang,apiKey,modelPreference,allowPreview,glossary}`. Response `{reviews:[{id,status,suggestion?,reason?}]}`. IDs are page-local decimal indices. Missing or malformed results remain unavailable. At most 64 items and 2000 characters per field; excess items remain flagged rather than silently cleared.
- Review after omission recovery, before rendering, using existing provider routing. Cancellation aborts; other failures preserve successful translation with unavailable review metadata. Never modify geometry or deleted/manual items.
- Editor shows source and suggestions, lets users accept, keep original, or restore previous translation. Snapshot mismatch disables applying a stale suggestion. Manual edits, cancel, Undo/Redo must retain consistent review state.
- Export warns for unresolved semantic reviews; persistence retains metadata.

## Tasks

- [x] Pure review contract/parser/snapshot helpers with adversarial tests.
- [x] Bounded provider API and fidelity prompt, mocked route tests.
- [x] Pipeline integration with failure/cancellation coverage.
- [x] Editor suggestions and Undo/Redo with UI tests.
- [x] Export warning and persistence verification.
- [x] Independent review complete.
- [x] Runtime update after the user saves their work and confirms timing.

## Verification

Full translation/export/overlay/project persistence suite: 481 tests across 53 files passed. After the reviewer's autosave cancellation finding, focused 125 tests passed including the new regression. TypeScript passed. ESLint: zero errors, four existing hook warnings. Independent reviewer checked 100 tests and found one P2: cancelled editor metadata could remain persisted. Fixed by marking restored draft state dirty via saveAdjustment; reviewer independently passed five cancellation tests and approved with no remaining findings. Git diff --check passed.

The checker does not guarantee semantic correctness, especially when source OCR is inaccurate or context is missing. Old saved pages keep their translations; retranslation runs the checker. A provider failure retains the translated page and displays an explicit review warning. No real provider calls were made during automated verification.

Runtime: user confirmed saved work and approved update. Production build and asset sync succeeded. Web restarted hidden as PID 40412, build `SPD4wbwLllumGWy_ZGWH3`. Web and OCR health returned 200; web HTML contains the current build ID. Empty review input returned 400 without making a provider call.

## Constraints

Preserve earlier uncommitted work and unrelated AI-WORKING-NOTES. No model/SDK migration. No real provider calls on user manga. No automatic correction, commit, push or service restart in this plan. Ask restart timing only after the result is tested and reviewable.
