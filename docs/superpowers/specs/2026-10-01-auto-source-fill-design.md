# Auto Source Fill Design

The user selected original text fill color after reviewing the real-source comparison. This changes the previous white-fill/source-colored-outline policy only for confidently admitted automatic source profiles.

In the shared style resolver, Auto preserves recovered fill, outline, and gradient when color matching is enabled, source is auto, evidenceState is admitted, and fill confidence meets the existing minimum (0.80 by default). Reject/background-contamination gates take precedence. Explicit readable/manual choices, monochrome manga policy, global matching disabled, nearby fallbacks, unverified/low-confidence profiles, and the standard shadow policy keep existing behavior. Profiles are not rewritten, so stored original colors remain available. Existing source_faithful mode remains supported.

Preview and export already consume the shared resolver; verify both with real pixel extraction fixtures and regression tests. No OpenCV dependency, removal-mask sampling, or segmentation prototype enters production. This restores recovered fill colors; it does not claim exact outline/gradient extraction in every crop. No commit/push unless newly requested; production restart only if authorized for this change.

Persisted derived images carry a render policy version. Restoring an older version drops cached images for pages with eligible Auto profiles and recoverable sources, keeping bubbles and originals. The next full or incremental save cannot relink those obsolete images through LRU preservation. Regenerated renders use the current version; unaffected manual/readable and unrecoverable-source images remain available.
