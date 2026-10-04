### Spec Compliance

- ❌ CORE issues found for frozen 74e51a2..4abf55d: unchecked layout snapshot lines bypass generated-text validation (chrome-extension/content.js:384,388,455), and malformed background approval values pass the publication interface (lib/extension/strictParity.ts:24; src/app/api/extension/publish-back/route.ts:90).
- ⚠️ Full G05 remains incomplete until workspace handoff restores original sourceImage, exact sourceRevision and targetIdentity, and explicit human image evidence/contextual confirmation semantics are integrated. The blocked-job payload supplies these assets (chrome-extension/background.js:90,100), but the workspace consumer is outside this frozen diff. S03/G03 integration requires a separate gate.
- ⚠️ R03 must later qualify full source/clean/background evidence and bind approval to current revisions. This review assesses the supplied-state interface only; it does not certify full background safety (lib/extension/strictParity.ts:7,24).

### Strengths

- Canonical catalog, Unicode script inspection and bounded shared review/repair are bundled from TypeScript rather than duplicated browser rules; worker, popup, static content and injected content load policy first (chrome-extension/policy-entry.ts:1; chrome-extension/background.js:2,25,94; chrome-extension/manifest.json:29; chrome-extension/popup.html:82).
- Exact raw fallback text, source transcript, target and policy snapshots are checked at reader and publication boundaries. Malformed core bubble fields fail closed before replacement; a real DOM regression preserves the previous reader (lib/extension/strictParity.ts:9,14,23; chrome-extension/content.js:145; tests/chrome-extension/strictReader.test.ts:6).
- Original fetched-byte SHA256 has no weak fallback, and production Blob parity is covered (lib/extension/sourceFingerprint.ts:4; tests/chrome-extension/sourceFingerprint.test.ts:12).
- Explicit packaging includes and rebuilds the generated bundle; rejected jobs provide an actual Editor control without inline unreviewed edits (scripts/package-chrome-extension.mjs:1,9; chrome-extension/content.js:23,456).

### Issues

#### Important (Should Fix)

- chrome-extension/content.js:384,388,455 — Snapshot identity checks validate snapshot.text against the reviewed bubble but then render snapshot.lines without proving those lines contain the reviewed text. A valid Thai bubble and matching snapshot.text with lines:['ABC'] passes inspectExtensionOutput and draws rejected Latin lettering. Non-string line entries are also accepted and stringified by join. Require string lines and a verified correspondence to exact reviewed text, plus inspect the actual drawn text under the target policy; otherwise discard the snapshot and fit reviewed text. Add a real reader regression with altered snapshot lines.
- lib/extension/strictParity.ts:24; src/app/api/extension/publish-back/route.ts:90 — Untrusted backgroundState is passed straight into the shared typed gate. That gate only rejects missing/unavailable/unresolved states, so backgroundState:'garbage' (or another truthy malformed value) makes publication eligible, even with no backgroundRevision. Require an explicitly valid approved state at the runtime boundary; validate the revision contract separately as integration requires. This is a current supplied-state fail-closed defect independent of future R03 qualification. Add a POST regression for unknown/string/object values.

#### Minor (Nice to Have)

- tests/chrome-extension/strictParity.test.ts:17; tests/chrome-extension/policyBundle.test.ts:5 — Snapshot and packaging checks mostly assert source substrings/catalog equality. They do not establish actual snapshot text integrity or deterministic bundle provenance across the full shared checker graph. Strengthen the specific snapshot regression above; retain a rebuild comparison in the verification gate when shared policy modules change.

### Assessment

- **CORE task quality: Needs fixes.** Shared rule reuse and the raw text/evidence checks are sound improvements, but actual drawn snapshot text and malformed publication approval states still bypass the intended gate.
- **Checks:** Read the frozen diff; initial tool truncation required bounded recovery of cut sections. No changed working source was read, no git command was run, no code was edited, and the reported 45 focused tests were not rerun.
- **Focused named doubt:** Executed the frozen policy.js extracted directly from G05-review.diff in an isolated Node VM; current reviewed Thai text with a 64-character source hash and backgroundState:'garbage' returned status:'eligible', reasons:[], backgroundRevision:null. This verifies the malformed supplied-state publication bypass without depending on concurrent S03 edits.
