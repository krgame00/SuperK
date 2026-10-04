# R03 combined clean-image and translation output gate

Status: implemented with integration concerns; G06 still owns the isolated production build and browser acceptance pass.

## Changes

- Extension display and publish-back now require current contextual text evidence and a complete background inspection result. The inspection must recompute to the supplied revision key, match the page's source SHA-256, and derive the same eligibility state. Missing, malformed, stale, open-candidate, truncated, and failed inspection results remain blocked. Only exact candidate artwork confirmation or exact-revision whole-image acknowledgement resolves its corresponding finding.
- The shared inspection revision and eligibility contract moved to `lib/cleaning/backgroundInspectionContract.ts`; the extension policy bundle imports this small contract rather than bundling the image detector.
- Publish-back verifies SHA-256 of the actual clean image data URL against the inspection's clean-background revision on both POST and single-record GET. The approved inspection and translated text remain separate fields and both are required.
- The editor now retains the reader's image URL separately from its saved source data URL. This identity persists in project sessions, so extension updates target the matching image after reload while the editor continues to own a local, recoverable source image.
- The extension caches and broadcasts the full background proof with approved publication updates. Direct extension output without workspace background review opens the existing SuperK review handoff instead of displaying an uninspected result.

## Verification

- RED/GREEN: publication proof without evidence and clean-image bytes that differ from the reviewed revision are rejected; a fully bound proof is accepted.
- Focused R-wave and integration tests initially passed 9 files/77 tests; after updating legacy extension fixtures to assert the new review handoff, the combined extension, mask, drag and size selection passed 34 files/311 tests. Coverage includes the detector contract, strict extension reader, bidirectional publication, POST/GET gates, handoff verification, persisted reader-image identity and workspace exports.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --pretty false` passed.
- Scoped ESLint passed with existing warnings in `hooks/useTranslation.ts` and `src/app/page.tsx`; `chrome-extension/background.js` is ignored by the repository ESLint config.
- Extension policy bundle regenerated with `node scripts/build-extension-policy.mjs`.

## Limits and follow-up

- The server verifies the proof structure, exact source identity, and actual clean-image bytes; pixel detection remains the local app's bounded inspection. It does not rerun image analysis on the server.
- Direct extension translation now fails closed until reviewed in SuperK. This can add a review step for existing extension-only use, by design.
- Browser checks across page sizes/ordering, cached outputs and real extension reload remain part of G06; no live service was restarted.
