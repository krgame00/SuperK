# Mask region safe cleaning

## Summary

Manual cleaning could act on stale region identity or a mask extending beyond the selected text region. The cleaning path now validates the selected region and the exact mask before authorizing pixel changes.

## Root cause

The editor's Clean Now path could fall back to a full region mask when no proposed mask remained. Cleaner restart also invalidated a job ID without giving the editor a safe region match. Persisted approval metadata could outlive its mask image or lack a revision. These separate gaps allowed the UI's intent, the backend's authorized mask, and the restored state to diverge.

## Fix

The editor reuses the proposed mask and attempts at most one refresh, then stops on empty data. Masks drifting at most two pixels are clipped; larger drift stops. Recovery requires exact identity or a strong, unambiguous geometric match, and intersects edits with the recovered rectangle. The backend authorizes only a nonempty normalized mask with an exact approval revision. Cache restoration verifies the actual mask asset and its fingerprint.

## Validation

Deterministic frontend and Python tests cover empty masks, bounded drift, stale region matching, confirmation retry, revision mismatch, and cache restoration. Final suites: 929 Vitest tests passed (1 skipped) and 186 Python tests passed (3 skipped). A browser run on the cached Region 17 source produced a repaired and approved Region 17, with 13,278 changed pixels inside the selected region and zero outside that region or the final mask. The live browser run did not replay a cleaner restart or two-pixel drift; those cases remain covered by deterministic tests.

## Why it slipped through

Earlier tests focused on successful region cleaning and did not assert the relationship among proposed mask pixels, selected bounds, approval revision, and persisted image bytes across restart.
