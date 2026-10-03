# Multilingual translation guard

## Approved intent

The user confirmed that contamination checking should follow every selected target language, across translation, quality review and saved work. Preserve permitted names and SFX; retry or flag problematic output. Languages sharing a script require contextual review rather than a script-only assertion.

## Current constraints

The existing Unicode detector permits Thai/Latin and inherited marks. The image retry, page scan, saved editor and quality-review guard explicitly skip non-Thai targets. Quality review already receives the target language and source text. Keep the existing bounded image retry and explicit suggestion acceptance. Do not silently rewrite saved text or strip foreign letters.

## Approaches

1. Recommended: shared target-language script profiles plus existing source-backed AI quality review. Local detection catches clear script mismatches without provider access; contextual review handles shared alphabets and legitimate names.
2. AI review alone: broader contextual reach, but no local protection when unavailable and greater dependence on model decisions.
3. Script profiles alone: fast and deterministic, but cannot distinguish English from French or Chinese text from Japanese kanji.

## Design

- Introduce a shared language policy module. Resolve exact normalized language names and locale aliases; do not infer language from arbitrary substrings. Support the application's targets and common international targets with explicit script profiles, including Latin, Cyrillic, Greek, Hebrew, Arabic, Thai, Han/kana, Hangul/Han and Indic scripts. Respect script-specific locales where a language has multiple writing systems. Japanese permits Han, hiragana and katakana; Korean permits Hangul and Han.
- Permit digits, punctuation, symbols, emoji and shared inherited marks. Non-Latin targets retain permitted Latin names/SFX as today. An unrelated script embedded in a word remains detectable. Legitimate names written in another script require review rather than automatic deletion.
- Every target receives a contextual quality-review instruction: assess whether dialogue and suggested replacements are in the selected language, allowing source-backed names, glossary terms and SFX. For unknown or ambiguous language profiles, use contextual review and explicitly avoid declaring local script validation successful. No unsupported-language fallback to Thai.
- Use the same policy in the image retry, final page warning, whole-book scan, client/API quality-review guards and saved editor. Retry remains at most once and retains the cleaner result. Existing slice/OCR retry behavior remains unchanged; its output is reviewed and warned.
- Same-script mismatches are handled by provider review. When provider/source is unavailable, retain the existing unavailable status; do not label text linguistically verified merely because its script is allowed. A contaminated provider suggestion is rejected locally; a clean suggestion still needs user acceptance.
- Apply Thai-specific normalization only to Thai targets. Non-Thai output must retain native joiners, diacritics and formatting rather than pass through Thai cleanup.
- Preserve page data, original source, geometry, history and export review gates. Existing pages are flagged on inspection/opening, not rewritten on load. Changing the selected target must re-evaluate local checks and must not reuse approval for another target as proof of language validity.

## Acceptance and verification

- Valid Thai, English, French, Japanese, Chinese, Korean, Russian, Greek, Hebrew, Arabic, Hindi and representative additional profiles are not flagged for their native scripts.
- Cross-script contamination triggers the same bounded retry/warning and suggestion rejection for non-Thai targets as for Thai. Deleted points remain excluded; legacy translated fields are checked.
- Locale aliases, multiple-script languages, unknown targets, supplementary characters, script-specific inherited marks, accented Latin, punctuation and numbers have regression fixtures.
- Shared-script wrong-language output is tested with mocked contextual review responses. Tests distinguish contextual approval from local script compatibility; no claim of perfect language detection.
- Saved edits with stale/missing review metadata are checked against the current selected target. Target changes invalidate language-dependent review acceptance.
- Non-Thai normalization preserves Arabic joiners and decomposed marks. Existing Thai normalization behavior remains covered.
- Verify focused unit/hook/editor/API/export tests, TypeScript, changed-file lint and production build. Real provider calls using user work are excluded from automated verification. Service restart requires confirmation that current work is saved.
