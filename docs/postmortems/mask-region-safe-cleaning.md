# Mask region safe cleaning

## Summary

Manual cleaning could act on stale region identity or a mask extending beyond the selected text region. The cleaning path now validates the selected region and the exact mask before authorizing pixel changes.

## Root cause

The editor's Clean Now path could fall back to a full region mask when no proposed mask remained. Cleaner restart also invalidated a job ID without giving the editor a safe region match. Persisted approval metadata could outlive its mask image or lack a revision. These separate gaps allowed the UI's intent, the backend's authorized mask, and the restored state to diverge.

## Fix

The editor reuses the proposed mask and attempts at most one refresh, then stops on empty data. Masks drifting at most two pixels are clipped; larger drift stops. Recovery requires exact identity or a strong, unambiguous geometric match, and intersects edits with the recovered rectangle. The backend authorizes only a nonempty normalized mask with an exact approval revision. Cache restoration verifies the actual mask asset and its fingerprint.

## Validation

Deterministic frontend and Python tests cover empty masks, bounded drift, stale region matching, confirmation retry, revision mismatch, and cache restoration. Final suites: 929 Vitest tests passed (1 skipped) and 186 Python tests passed (3 skipped). Live Region 17 replay used a fresh isolated cleaner cache to force stale-job recovery, then a 2 px brush at the region boundary. Recovery completed without "Job not found"; the bounded-drift run kept the editor open with an adjustment notice. Comparing its result with the immediately preceding clean image showed 128 changed pixels inside the region and none outside the region or final approved mask.

## Why it slipped through

Earlier tests focused on successful region cleaning and did not assert the relationship among proposed mask pixels, selected bounds, approval revision, and persisted image bytes across restart.
