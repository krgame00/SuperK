# Translation completeness

User approved on 2026-10-02 after comparing source page 21 with exported PDF page 21. A cleaned upper-left dialogue region has no replacement; colored regions retain source text. The PDF alone cannot distinguish provider omissions from filtering. Independently reproduced: five identical translations in distinct boxes are reduced to three by the current text-count filter.

Keep identical text at distinct positions. Merge only equivalent text in substantially overlapping valid boxes; retain unknown geometry rather than silently deleting it.

Compare valid nonempty translations with detected, unprotected cleaning regions. Invalid whole-page boxes cannot satisfy coverage. Preserve intentional manual deletions. Coverage cannot prove the absence of text that neither detector nor provider recognized.

On successful initial translation, retry only uncovered regions from Original pixels once per region, at most six regions per page. Crop with padding, map returned coordinates back to page space, admit only results covering their target and respecting protected scope, and retain successful existing translations. Stop recovery on provider safety, quota, or cancellation; do not bypass provider restrictions. Failure keeps partial translations available for editing, with a warning.

Export review uses the current cleaning regions and bubble cache, including restored sessions. Show the number of uncovered detected regions and a link to the affected page. Existing explicit review confirmation can proceed. Newly discovered omissions must not silently export on stale confirmation.

Validate with synthetic nonsexual fixtures for distinct repeated boxes, duplicate geometry, omissions, invalid boxes, protected regions, recovery mapping, partial failure, cancellation and export review. The historical PDF is evidence of omission, not proof that the current fixes fully repair that page without a fresh run.
