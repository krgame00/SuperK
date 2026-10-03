# Multilingual translation guard — design interview

## Confirmed requirements

- Check translations against every selected target language, including saved work and quality-review suggestions.
- Strict Thai output permits no other-language lettering, including Latin names, SFX and glossary terms. Translate or transliterate them rather than deleting arbitrary letters.
- Detect excluded lettering across Unicode scripts rather than a finite list of known contaminating languages.
- Distinguish foreign-script contamination from shared-script language mismatch; contextual review is needed for the latter.

## Decision tree

1. Strict target-language output — confirmed.
   - Native names/SFX — no foreign-letter exception in Thai, confirmed.
   - Nonletter content — Q3 confirmed: ASCII/Thai digits and ordinary punctuation/symbols; normalize other numeral forms to ASCII.
2. Verification outcomes.
   - Detected script violation after correction — Q1 confirmed: withhold rejected point text, retain selectable editing diagnostics; block translated export for affected pages.
   - Script-compatible output with unavailable contextual review — Q2 confirmed: allow explicit human contextual verification; script violations cannot be bypassed.
   - Target-language selector — Q4 confirmed: main workspace and extension share supported language/script choices, Thai default.
3. Correction and saved work.
   - Repair granularity — Q5 confirmed: repair affected text only from reliable source, preserve geometry/style and other points; missing source requires human repair.
   - Saved work — Q6 confirmed: inspect on opening/export; explicit whole-book repair command, preserve previous text for undo; opening does not submit provider requests.
   - Remaining: legacy target identity, source-image residue boundary, unusual target languages, retry budget and batch behavior.
4. Final acceptance.
   - Depends on the above: scope, tests, limits and user confirmation of shared understanding.

## Round 1 accepted decisions

- Q1: Withhold only rejected translated points in preview, retain selectable diagnostic points for editing, and block translated export for affected pages.
- Q2: Permit explicit human contextual verification when local script validation passes; detectable script violations cannot be bypassed.
- Q3: Allow ordinary punctuation/symbols, ASCII and Thai digits; normalize other numeral forms to ASCII without retaining foreign lettering.

Implementation is not authorized by this interview record. Update the main design and record consequential decisions as answers settle.

## Repository findings and next frontier

- The main workspace holds Thai as its default target and currently exposes no target-language selector. The extension exposes Thai/English/Japanese/Chinese. APIs accept arbitrary target strings. These are implementation facts, not the desired coverage limit.
- Q4 confirmed: shared target selector in workspace and extension; Thai default, script variants where needed.
- Q5 confirmed: source-backed point-text repair with layout/style preserved.
- Q6 confirmed: automatic local inspection, explicit repair command with undo history.

## Additional verified constraints

- Saved sessions and review snapshots have no durable target-language identity. A migration must not infer language approval from old review status alone.
- Quality review runs automatically, but unavailable/needs-review results currently still render. Missing review metadata is not currently an export issue.
- Existing export confirmation is overridable. Strict script rejection needs a separate non-overridable rule.
- Export uses live canvas, cached translated image or fresh offscreen rendering. Validation must precede every choice; checking fresh text drawing alone is insufficient.
- Publish-back sends editable bubbles and clean background to the extension; its renderer and direct translation path currently have no shared script guard.
- Manual text is currently skipped by automatic quality review. The new policy must validate manual changes locally and preserve explicit human contextual confirmation.
- Subsequent frontier after Q4–Q6: extension publish/direct-path parity; selecting a language for legacy sessions; policy boundaries between generated translation text and remaining source-image text; retry budget and batch failure behavior; final concrete coverage and acceptance.

## Round 3 answers received

- Q7 confirmed: on first opening a legacy project, ask for its target language with Thai suggested; persist the answer and recheck rather than carrying forward old approvals.
- Q8 confirmed: also inspect source-text remnants in cleaned backgrounds. Report locations for mask review and block translated export until corrected or explicitly confirmed to be artwork; no automatic expansion of removal authorization.
- Q9 confirmed: block unsupported target policies with an explicit explanation; require a supported language/script choice before translation.

Q8 adds image-level verification separate from generated-text validation. Keep separate implementation deliverables with a shared export-eligibility result; define dependencies before writing plans.

## Round 4 frontier

- Q10 confirmed: one additional correction batch per page/run, containing affected point texts; revalidate once, then leave unresolved points for explicit retry/manual repair.
- Q11 confirmed: continue subsequent pages; require explicit repair, original-image selection or exclusion of affected pages before export, with affected pages clearly listed and no silent omissions.
- Q12 confirmed: next-job target changes preserve saved results and their own target labels; explicit retranslation changes an existing page's language and invalidates its old verification. This preserves ADR 0001's reading-result contract.

## Interview completion

All twelve decisions have answers. The main design and a separate source-remnant design capture the agreed scope. The user approved formal spec publication and testing seams on 2026-10-04 during to-spec. Specs are published as ready-for-agent in the configured local tracker under multilingual-translation-guard and source-text-remnant-review, covering workspace/output integration, Unicode/provider fixtures, original/clean-image comparison, saved work, manual edits, bounded correction, history, cache and extension boundaries. Detectable foreign-letter violations remain non-overridable; explicit contextual/artwork review remains permitted as agreed. No production implementation has begun; implementation planning is next.
