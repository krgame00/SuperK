# G05 extension strict parity report

Status: generated-text boundaries implemented and focused verification green. R03 full background evidence qualification remains a separate dependency; publication requires supplied background approval and does not infer it from generated text. Root coordinates G04 publication payload and G03 workspace handoff restoration.

## Scope and interfaces
- `lib/extension/strictParity.ts` reuses canonical catalog, raw script policy, exact review identity and bounded shared review/repair client. `ExtensionEvidence` fields: bubbles, targetIdentity, sourceRevision, optional backgroundState/backgroundRevision.
- Worker uses original fetched image bytes: sourceRevision is bounded lowercase SHA256 hex from the ORIGINAL bytes, identical to workspace production blobFingerprint. MIME labels do not enter the hash. Direct/server contextual requests share chunking, one repair round, malformed-ID handling and missing-source fail-closed semantics. Offline direct review uses Gemini interactions with canonical source prompt; no invented approval if unavailable.
- Content and cache boundaries re-evaluate evidence; legacy bytes stay stored but hidden/actionable. Rejected jobs offer source-backed Open Editor without drawing rejected text. Existing copies survive failed/malicious replacements. Inline edits use the Editor rather than bypassing review through contentEditable.
- Publish-back POST and GET/list recompute raw text/review eligibility, return 409 for unresolved snapshots; diagnostics remain in stored payload. Background state is an optional integration interface, not independently qualified full R03 evidence yet.
- Popup catalog generated from identical canonical target variants; unsupported settings blocked. No next-setting change clears reading copies.
- Exact float proportional layout snapshot consumed only with text/font/multiplier/frame identity; browser font absence displayed as source-size fallback tooltip. No new source-size inference rules. Direct auto measurement remains unsupported fallback.
- `policy-entry.ts` generated classic `policy.js` bundle loads before worker/popup/content; deterministic TS transpile graph rejects external dependencies. Explicit package allowlist includes bundle; packaging rebuilds it. No dependency upgrades.

## Tests / RED -> GREEN
Commands use `node node_modules/vitest/vitest.mjs run --root . ...` because global npx wrapper is broken (missing npx-cli.js).
- strictPublication: RED accepted legacy raster (200 vs expected 409); GREEN rejects old/unidentified/contaminated output and accepts current source/context/background evidence.
- strictParity: RED missing review adapter, content gate, offline source adapter, snapshot consumption and actionable review UI; GREEN all five checks.
- strictEvidence: canonical raw scripts including supplementary glyph; stale text/source/policy, malformed missing/duplicate IDs, single source-backed repair, generated preview vs publication distinction.
- strictReader: real DOM malicious replacement cannot replace current lettering; previous reading copy retained.
- policyBundle: packaged catalog equals shared TS catalog and loader/allowlist include bundle.
- Existing runtime/popup/publishBackResilience fixtures updated to load policy bundle and supply current exact source-backed identities.

Final focused command:
`node node_modules/vitest/vitest.mjs run --root . tests/chrome-extension/strictParity.test.ts tests/chrome-extension/strictEvidence.test.ts tests/chrome-extension/strictReader.test.ts tests/chrome-extension/policyBundle.test.ts tests/extension/strictPublication.test.ts tests/chrome-extension/runtime.test.ts tests/chrome-extension/popup.test.ts tests/extension/publishBackResilience.test.ts`
Superseding final result: 9 files, 43 tests PASS after original-byte source identity correction.
`node --check` background/server/content/popup: PASS.
Bundle generated twice: identical SHA256 (before final null-safe type fix).
`node node_modules/typescript/bin/tsc --noEmit --pretty false` filtered owned paths: no owned-path diagnostics after fixes; full project result not claimed clean (other concurrent work).

## Remaining integration / limitations
- R03 must qualify full source/clean/background evidence and bind revision, replacing simple optional backgroundState input. Current publication rejects missing background approval; generated-only success is never asserted as final safe.
- G04 publisher must send targetIdentity/sourceRevision/backgroundState/backgroundRevision; coordinated directly with g04_output_fix.
- G03 workspace handoff consumer needs restoration of original sourceImage, targetIdentity and exact sourceRevision; requested root-coordinated proposal only, no page/hook edits made.
- Previous broad extension tests with legacy unverified success fixtures may need migration to new required identity semantics; only explicitly listed focused regression files were run/updated. Full suite not run.
- Explicit contextual confirmation occurs through actual Open Editor review control; no new extension-local accept/dismiss bypass.
- No live provider keys, live restart, index, commit, or full suite run.

Final rerun after fallback tooltip/type fixes: 8 files / 40 tests PASS (18:08:23).
Final deterministic bundle SHA256: C54617D7495EBEE516C76A59A5291CEEB7ED9C40F1B8832E5CBB4BFB3F703C4F. Removed duplicate broadcast identity fields found by final inspection.

## Original-source identity correction (supersedes initial sourceRevision contract)
- New `lib/extension/sourceFingerprint.ts` exposes `sourceBytesFingerprint(Uint8Array)` and `originalSourceFingerprint(base64)`: SHA256 lowercase 64-character hex; never MIME:base64, size, or weak fallback.
- Exact handoff sourceRevision is this SHA256 of original fetched bytes; sourceImage remains the original data URL asset. Existing review approvals are NOT rebound to the new identity; legacy revision snapshots are blocked until reviewed again.
- Missing crypto sends source-backed Editor invitation with no sourceRevision approval, does not render translated glyphs.
- Runtime VM tests use real Node webcrypto. `sourceFingerprint.test.ts` RED three missing-export failures, GREEN equal-size different-content hashes, original Blob identity parity against actual workspace blobFingerprint in production mode, and unavailable crypto rejection.
- Root-approved unification proposal after R01 freeze: production blobFingerprint can delegate to sourceBytesFingerprint(new Uint8Array(await blob.arrayBuffer())); preserve deliberate test fake separately. No R01 module edited.
- Superseding focused command adds `tests/chrome-extension/sourceFingerprint.test.ts` to prior eight test files: final 9 files / 43 tests PASS at 18:11:05. No full suite result claimed; broader legacy fixture migration remains for G06.

## Raw displayed-text boundary repair (supersedes prior 43-test snapshot)
- Reproduced validator `t:''/translated:'ABC'` Thai accepted review incorrectly eligible, and real content malformed replacement removed prior reader copy (two RED regression failures).
- `extensionDisplayedText` now exactly matches shared review/renderer raw expression `t || translated || ''`. Local script eligibility, reader fitting and snapshot identity consume that same raw value.
- Malformed t/translated/original_text/deleted/review field types fail closed before source trim/check; invalid target identity and sourceRevision types cannot create approvals. Reader refuses invalid replacement before removing previous copy.
- Public publish-back regression includes reviewed foreign fallback with empty t and malformed source; both return 409.
- Regenerated canonical bundle. Focused final command with sourceFingerprint, strictParity, strictEvidence, strictReader, policyBundle, strictPublication, runtime, popup, publishBackResilience: 9 files / 45 tests PASS at 18:18:00. Syntax check PASS; owned-path tsc diagnostics checked separately. No full suite or commit.
- Source-free human image evidence is NOT blindly approved. Future S03/G03 image-point evidence can be accepted only after actual exact source identity and explicit human confirmation metadata are wired; current shared policy shape still requires source transcript, proposed later integration rather than guessing approval.
