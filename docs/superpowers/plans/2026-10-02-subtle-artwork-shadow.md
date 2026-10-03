# Subtle artwork shadow trial

User approved trying subtle shadows on artwork text and no shadows in balloons on 2026-10-02. Keep font proportional sizes and user-owned Manual settings.

The current profiles contain semantic categories, not a complete balloon segmentation map. Treat dialogue and narration as no-shadow; explicit overlay subtitles and SFX use a subtle shadow. Unknown regions use chromatic evidence or a dark sampled background to identify artwork candidates; other unknown regions stay unshadowed. Original mode retains its existing behavior. Do not infer container geometry from text width.

Trial preset: black-ish `#1e1e1e`, opacity 0.30, blur 0.06 em, X/Y offset 0.025 em. Keep the existing Manual Standard/Off behavior.

- [x] Add failing resolver tests for dialogue, narration, overlay, SFX, unknown regions and Manual/Original.
- [x] Apply shadow selection at the shared renderer resolver boundary. Bump render policy and extend persisted cache invalidation to affected automatic pages, preserving missing-source images and explicit ownership.
- [x] Verify preview/offscreen Canvas calls, color matching, persistence, exports and TypeScript. Review the focused diff.
- [x] Install the approved trial for comparison in the user's browser after the user confirmed service-update timing. No commit/push requested.

Verification: 445 affected tests passed; TypeScript and production build passed. Scoped ESLint: zero errors, one existing unused `_category` warning. Independent review found monochrome SFX shadow exclusion and stale toolbar labels after manual color edits; both received failing regression tests and fixes, and the reviewer confirmed them. Preview/offscreen tests check subtle shadow settings and retained white fill/colored outline; these are Canvas call assertions, not pixel screenshots. Visual judgment remains the user's trial in the browser.

Deployment: stopped only the verified SuperK web process, built production assets, synced standalone assets, and restarted the web hidden. OCR remained running. The user confirmed their work was saved before restart.
