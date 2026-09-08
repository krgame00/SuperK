# Preserve editable local projects and confirm reviewed revisions

The initial release serves a small trusted team through local installations; access from anywhere remains a future direction. Recovery after refresh or unexpected app closure restores the latest successfully saved state, with unsaved changes clearly distinguished. Recovery after browser-data deletion or device migration is outside this release's agreed guarantee.

Retain the assets needed for region cleaning and retry for as long as the project is retained, rather than expiring them after a fixed 24 hours. The user accepts retaining this data so that older projects remain editable; project deletion defines the end of this retention obligation. The storage and cleanup mechanism must be designed to preserve that relationship.

Preserve artwork even when uncertain text remains. Pages with uncertain cleaning or translation require human confirmation before export. Confirmation applies to the reviewed image and text revision; subsequent image or text changes require confirmation again. This chooses explicit review and continuing editability over unrestricted export and automatic age-based cleanup.

These product decisions were accepted in the system review interview on 2026-09-08. They describe the intended contract, not a claim that the current implementation meets it.
