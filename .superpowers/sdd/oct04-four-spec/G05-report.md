# G05 shared translation evidence in the extension

Status: implemented with R03's combined background gate; G06 owns final integrated build/browser acceptance.

## Changes

- The extension policy uses the canonical target catalog, script policy, source fingerprint and point-review logic from the workspace bundle. Raw displayed lettering and exact source/review identities are rechecked at the reader and API boundaries.
- A reader layout snapshot is accepted only when its text lines are valid strings and their joined content is exactly the currently reviewed text; stale/mismatched snapshots are discarded and the current reviewed text is laid out again.
- Unknown/missing target, malformed source evidence and foreign script remain blocked. Unreviewed direct-extension output opens the SuperK review handoff instead of displaying; existing saved reader overlays survive rejected updates.
- Publish-back requires both contextual translation review and R03's exact source/clean background evidence. The API checks the posted clean image bytes before storing and again when retrieving a single publication. Original diagnostics and style fields continue through.
- Handoff restores the actual source bytes and source fingerprint to the local workspace, retains the reader image URL as a separate field for correct postback after save/reload, and preserves the canonical target identity.
- Generated extension policy rebuilt from shared modules; the policy bundle includes only the compact background evidence contract and does not bundle the pixel detector.

## Verification

- `node scripts/build-extension-policy.mjs` regenerated the extension policy.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false` passed.
- Combined extension, mask, renderer, saved-sizing and workspace-export selection: 34 files, 311 tests passed with `--maxWorkers 1`.
- Key regressions cover rejected snapshot lines, unchanged reader overlay on invalid update, exact source/target review identity, malformed/missing background proof, clean asset digest mismatch, postback retrieval, and persisted reader image identity.

## Limits

- Extension-only translations always route through the local reviewer because the reader script cannot create the workspace's mask/remnant inspection proof. This is fail-closed behavior, not a display-time review bypass.
- Pixel-level remnant classification still runs in the local workspace; the publish API verifies the supplied exact revision and clean bytes but does not repeat image analysis server-side.
- Real browser reload and installed extension acceptance remain part of G06.
