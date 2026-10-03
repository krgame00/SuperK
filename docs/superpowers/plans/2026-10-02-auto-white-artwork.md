# Auto White Artwork Implementation Plan

**Goal:** Apply the approved white interior / source colored outline presentation in Auto.

**Architecture:** Preserve original extraction evidence. Resolve artwork presentation centrally, before the admitted source fill shortcut; version saved derived images.

**Tech Stack:** TypeScript, Vitest, existing canvas and project store.

## Tasks

- [x] Add failing resolver regressions covering reversed roles, unknown colored text, light/weak accents, dark backgrounds, ownership, disabled matching, and white balloons.
- [x] Add a bounded Auto artwork eligibility/presentation helper in `lib/colorMatching/resolveTextStyle.ts`, route eligible profiles through it, bump render policy, and extend store invalidation to those profiles.
- [x] Update superseded Auto source fill assertions; retain Original-mode and extraction fidelity assertions. Verify color matching, project restore, rendering/export, types, and scoped lint.
- [x] Record results and limitations. No commit/push requested. The user subsequently approved a web service restart after saving their work.

## Verification and delivery

- Initial new policy regressions: 6 failures / 12 tests, proving colored interiors and reversed roles under the previous resolver.
- Independent review added three failing tests for weak contour evidence and explicit monochrome ownership. Further tests reproduced saved monochrome-cache retention and accent-only loss. All were corrected.
- Full affected run: 49 files / 439 tests passed. Final color matching + project store rerun after the last fixes: 35 files / 311 tests passed, including the 3 newly added regressions. Actual single/offscreen canvas tests passed in the 56-test overlay suite. TypeScript and production build passed; scoped lint had zero errors and one pre-existing unused `_category` warning.
- Independent reviewer reran 48 tests and found no remaining important issue.
- Deployment authorized by the user. The first build encountered a locked standalone directory; after verified termination of only the SuperK web process, production build and asset sync passed. Web restarted hidden; HTTP 200, served build ID `gUPZBWvkMI1aZpMVlUW1h` matched `.next/BUILD_ID`; OCR health remained HTTP 200.
- This changes rendering policy, not the source extractor. Its white-core / colored-contour ambiguity remains reproducible in Original mode and is outside this approved presentation change. The PDFs supplied are past exports, not original extraction metadata; a new full-book PDF has not been visually compared here.
- Existing dirty `docs/AI-WORKING-NOTES.md` was preserved. No commit or push performed.