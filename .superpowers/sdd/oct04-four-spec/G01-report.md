# G01 implementation report

Status: production integration implemented and focused verification complete, awaiting root independent review and commit coordination. G02 contextual review, G03 legacy/manual confirmation and G04 final output gate remain separate tickets.

## Resumed changes

- `guardQualityReview` now inspects reviewed text and suggestions against canonical target script policy for every target. Invalid suggestions are withheld; unknown or ambiguous target identities cannot receive approval. Thai prompt requires Thai lettering for Latin names, SFX, brands and glossary entries.
- Native Han variation selectors U+FE00..FE0F and U+E0100..E01EF are preserved only directly after a Han letter in a profile allowing Han. Orphan, incompatible-base and stacked selectors remain blocked. No blanket Inherited-script exemption was added.
- Confirmed shared page eligibility already blocks absent contextual/background evidence by default. Explicit local preview requirements remain scoped exceptions.
- Unassigned code points, private-use characters, lone surrogates and non-whitespace controls now fail closed. Only known punctuation/symbols/separators, tab/newline/carriage return and explicitly permitted formatting can pass after script inspection. Existing approved native joiners/marks and emoji remain context checked.

## Verification

- Quality review RED: 10 failed, 12 passed, before production change.
- Han selector RED: 4 failed, 52 passed, before production change.
- GREEN: `node node_modules/vitest/vitest.mjs run tests/translation/languagePolicy.test.ts tests/translation/qualityReview.test.ts tests/translation/pageEligibility.test.ts --root . --maxWorkers 1`: 3 files, 84 tests passed (6.83s).
- `node node_modules/typescript/bin/tsc --noEmit`: passed after final pure-policy changes; final integration check remains required.
- Global npx wrapper is broken (missing global npx-cli.js); direct local Node entrypoints work. First RED worker run took 28.73s and exited; no worker session remains.
- Unverifiable-character RED: 9 failed, 57 passed. Latest focused GREEN: 3 files, 94 tests passed (6.86s), same command above.
- Test runtime reports Unicode 17.0 (`node -p "process.versions.unicode"`). Browser runtimes may provide different Unicode tables; unknown/unassigned code points in the executing runtime are blocked. The policy does not claim to recognize future Unicode letters or private font glyph meanings.

## Primary Unicode references

- https://unicode.org/reports/tr37/ — ideographic variation sequences use ideographic bases followed by supplementary variation selectors.
- https://unicode.org/faq/vs.html — variation selectors modify the preceding base in an appropriate sequence.
- https://unicode.org/reports/tr24/ — Inherited marks take script context from their associated base.

## Implemented integration

1. Workspace Settings selector is wired to next-job target; actual page jobs capture canonical identity before asynchronous cleaning/provider execution. Retry attempts retain that job identity. Successful rendered result commits URL-keyed target cache, persisted/remapped through stable page IDs. Failed retranslation preserves old result/identity.
2. Every legacy payload normalization path, including crops/recovery/retry/tiled translation, now inspects raw target text before Thai cleanup. Persian native marks/newlines remain unchanged. Crop translation blocks mismatched or unconfirmed existing-page target, and offers whole-page retranslation.
3. Restore/edit/render/export use recorded page target; missing and obsolete policy identities withhold lettering. Workspace displays recorded target or unconfirmed label; changing next-job selector cannot relabel prior pages. CBZ language metadata uses recorded page languages, with `mul`/`und` for mixed/unconfirmed books.
4. Invalid lettering is withheld while selectable editable frames, source sizing metadata and offending-character diagnostics remain. Diagnostics show bounded characters plus code points and additional count. Legacy Thai foreign numeral forms render normalized values with an explicit note, retaining stored text.
5. Restored baked images with unconfirmed/obsolete/invalid script state or unnormalized foreign numeral forms are removed from preview cache, keeping points/source asset. Fresh safe renders remain cached. This prevents scroll thumbnails from bypassing deterministic checks; no provider or cleaning is launched on restore.
6. Hook exposes `pageTargetCacheRef`, `getPageTargetLanguage(pageUrl)` and default-strict `inspectPageOutputEligibility(pageUrl)` for subsequent boundary integration. Pure eligibility remains bound to target/policy/text/source/background revisions and defaults missing context/background to blocked. G04 must stop final whole-page output; G01 only suppresses lettering locally.

Unrelated dirty documentation and S01 hook/overlay/test changes have been preserved.

## Integration RED prepared after S01 freeze

- New standalone `tests/translation/useTranslation.targetPolicy.test.tsx`: 5 expected failures confirm absent page target capture/restore/persistence, failed-retranslation identity preservation, and the raw-normalization bugs. Actual old hook reduced `A: สวัสดี` to `สวัสดี`, and `می‌خواهم\nسلام` to `میخواهم سلام`.
- New standalone `tests/translation/targetPolicyOverlay.test.ts`: 4 expected failures and 1 positive target render passed. Current renderer still inks excluded characters and renders unconfirmed/unknown/ambiguous targets. Tests require selectable frames, original editor text and offending-character diagnostics after withholding glyphs, including with old accepted review status.
- After S01 clearance at `64b99f7`, integration proceeded on shared production files while preserving S01 source sizing cancellation/revision ownership guards. Contracts use URL-keyed `pageTargetCacheRef`, canonical recorded target supplied as existing overlay argument 10, and wrapper `data-script-status`/title diagnostics.

## Integration verification and ownership

- Additional RED checks: changing selector during asynchronous cleaning changed the active target; obsolete recorded policy still rendered; restored scroll bitmap still leaked blocked lettering/raw numerals; invisible diagnostics omitted code points; legacy numeral renderer drew raw Arabic digit forms. Each was observed failing before its fix.
- Final focused command ran policy, quality review, eligibility, persistence, Settings selector, actual hook/overlay guard, source-size overlay, full overlay regressions, source-size hook and outline restore: 12 files / 270 tests passed (28.61s).
- Final `node node_modules/typescript/bin/tsc --noEmit` passed after concurrent S02 helper work settled. An earlier transient S02 test signature error was superseded by this successful final check.
- Focused lint: zero errors, seven existing warnings in hook/page (unused imports/variables and hook dependency warnings). No provider calls, restarts, full suite, staging or commit performed.
- Read Next client directive guide `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` before client UI code.

G01-owned paths for root commit coordination:

- `components/workspace/SettingsModal.tsx`
- `hooks/useTranslation.ts`
- `lib/languagePolicy.ts`
- `lib/projectStore.ts`
- `lib/translation/pageEligibility.ts`
- `lib/translation/qualityReview.ts`
- `lib/translationOverlay.ts`
- `src/app/page.tsx`
- `tests/browser/source-size.ts` (explicit English/Thai fixture targets only)
- `tests/cleaning/sourceSizeOverlay.test.ts` (explicit fixture targets only)
- `tests/cleaning/translationOverlay.test.ts` (explicit fixture targets only)
- `tests/translation/languagePolicy.test.ts`
- `tests/translation/pageEligibility.test.ts`
- `tests/translation/pageTargetPersistence.test.ts`
- `tests/translation/qualityReview.test.ts`
- `tests/translation/targetPolicyOverlay.test.ts`
- `tests/translation/useTranslation.targetPolicy.test.tsx`
- `tests/translation/useTranslation.test.tsx` (canonical target expectation only, preserve prior S01 mocks)
- `tests/translation/useTranslation.outlineRestore.test.tsx` (explicit English saved target only)
- `tests/workspace/SettingsModalTargetLanguage.test.tsx`
- `.superpowers/sdd/oct04-four-spec/G01-report.md`

Do not stage unrelated dirty documentation, P01 reports, S02 source-size modules or tests.

## Important review fix: raw edge controls

- Renderer now inspects complete stored bubble text before trimming eligible normalized text for layout. Diagnostic normalization notice compares policy normalization with raw text, so ordinary edge spacing is not mislabeled as numeral conversion. The editor review panel also inspects raw stored text before considering current accepted review metadata. Blocked lettering retains its selectable frame, original editor value and U+000B/U+000C diagnostics.
- Provider suggestion parsing now guards the raw suggestion before trimming a permitted suggestion or comparing it with the current translation. Forbidden leading/trailing vertical tab and form feed cannot disappear into an accepted replacement; raw reviewed text handling is preserved.
- Owned changed files: `lib/translationOverlay.ts`, `lib/translation/qualityReview.ts`, `tests/translation/targetPolicyOverlay.test.ts`, `tests/translation/qualityReview.test.ts`, and this report. Concurrent S02 changes were preserved.
- RED command: `node node_modules/vitest/vitest.mjs run tests/translation/targetPolicyOverlay.test.ts tests/translation/qualityReview.test.ts --root . --maxWorkers 1` exited 1: 2 failed files, 8 failed / 29 passed tests (4.26s). Four actual renderer cases inked Thai text despite forbidden edge controls and accepted review metadata; four parser cases returned `suggested` instead of `needs_review`.
- Final GREEN command: `node node_modules/vitest/vitest.mjs run tests/translation/targetPolicyOverlay.test.ts tests/translation/qualityReview.test.ts tests/translation/languagePolicy.test.ts tests/cleaning/sourceSizeOverlay.test.ts --root . --maxWorkers 1` exited 0: 4 files / 111 tests passed (10.32s), including original editor preservation, current accepted review panel diagnostics, native policy and source sizing regressions.
- `node node_modules/typescript/bin/tsc --noEmit` exited 0 with no output.
- `node node_modules/eslint/bin/eslint.js lib/translationOverlay.ts lib/translation/qualityReview.ts tests/translation/targetPolicyOverlay.test.ts tests/translation/qualityReview.test.ts` exited 0 with no output (zero errors/warnings).
- Read the installed Next client directive guide before editing. No full suite, provider calls, restart, staging or commit performed.
