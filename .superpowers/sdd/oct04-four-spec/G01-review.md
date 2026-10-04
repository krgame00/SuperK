### Spec Compliance

- ❌ Issues found: raw inspection is bypassed for leading/trailing forbidden whitespace controls in the overlay (`lib/translationOverlay.ts:1051`).
- ⚠️ Cannot verify from diff: contextual evidence binding and final whole-page export blocking belong to G02/G04 and remain future work; this review does not certify them. Browser Unicode tables may differ from the reported Unicode 17 runtime (`G01-report.md:23`).

### Strengths

- Canonical target identity is captured before single-page asynchronous cleaning and passed into the job (`hooks/useTranslation.ts:1565`, `hooks/useTranslation.ts:1589`); render completion commits identity with the result (`hooks/useTranslation.ts:913`).
- Restored unsafe baked images are discarded while original editable points survive (`hooks/useTranslation.ts:731`). Stable page IDs carry target metadata through persistence (`lib/projectStore.ts:361`).
- Local script failure suppresses canvas lettering while retaining selectable frames (`lib/translationOverlay.ts:1176`), and provider suggestions are independently inspected (`lib/translation/qualityReview.ts:35`).
- Shared eligibility defaults to requiring contextual and background evidence and records target/text/source/background revisions (`lib/translation/pageEligibility.ts:44`).

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

- `lib/translationOverlay.ts:1051`: `rawText` is trimmed before `inspectTargetText`. JavaScript trim removes vertical tab U+000B and form feed U+000C at either end, even though the policy intentionally rejects them (`lib/languagePolicy.ts:203`). Thus a bubble containing `"\u000Bสวัสดี"` is rejected by normalization/page eligibility but is inked as eligible Thai by the local preview, loses its offending-character diagnostic, and a current provider review panel also inspects trimmed text (`lib/translationOverlay.ts:1544`). Inspect the complete stored text first; trim only the eligible text used for layout. Add an actual overlay regression covering leading/trailing forbidden controls and editor preservation.

#### Minor (Nice to Have)

- `G01-report.md:55`: focused lint reports seven existing warnings. They are acknowledged verification noise; no new warning attribution is demonstrated in this package.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The target identity, persistence and selectable hidden-lettering integration is coherent, but the renderer currently removes evidence before the deterministic check, contradicting the strict raw-inspection requirement.

**Checks:** Read the provided review package; the first output was truncated, so continued with bounded package sections to recover missing hunks. No Git commands or production edits; no tests rerun. A focused Node Unicode/trim probe confirmed U+000B/U+000C are removed by trim. A Unicode property probe investigated enclosed-letter symbols but produced no finding because the safe-symbol/emoji requirement makes that boundary ambiguous.

### Re-review: 5343e31 → 01101ee

- ✅ **Spec compliance: compliant for G01.** The Important raw-control finding is resolved: renderer inspection receives complete stored text and only eligible layout text is trimmed (`lib/translationOverlay.ts:1051`). The editor checks raw text before considering accepted metadata (`lib/translationOverlay.ts:1544`).
- ✅ **Task quality: Approved.** Related provider parsing now guards the raw suggestion before trimming (`lib/translation/qualityReview.ts:69`); this directly addresses the same evidence-loss mechanism without expanding scope.
- Strength: four actual-overlay cases cover leading/trailing U+000B/U+000C, suppressed ink, retained selectable frames, original editor text, review diagnostics and unchanged stored text (`tests/translation/targetPolicyOverlay.test.ts:52`). Four parser cases verify blocked raw suggestions and code-point diagnostics (`tests/translation/qualityReview.test.ts:7`).
- Findings: no new Critical or Important issues in the fix diff. The previous existing hook/page lint-warning note remains informational; owned fix lint is reported clean (`G01-report.md:87`).
- ⚠️ Deferred: G02 raw-client/exact contextual snapshot work and G04 final output gates remain outside this G01 verdict. Prior browser Unicode-runtime limitation remains.
- Checks: read the complete fix diff once and the updated report fix section. Report records 8 expected RED failures, 111 focused GREEN tests, clean type check and zero owned lint warnings (`G01-report.md:84`). No Git commands, production edits, outside-code checks or test reruns; no specific unresolved doubt justified another run.
