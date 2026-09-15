# Detected caption and balloon withheld from cleaning

## Summary

On the reported page, two visible text regions remained in both Clean and Translated views. Detection was complete: both were present in the saved job, but eligibility classified them as review/preserve. The fix measures background uniformity inside a verified closed light backing rather than including its border and surrounding artwork. The independent text-evidence gate remains unchanged.

## Root cause

The matched local job is `00fc271bfd9447729a7d076a1e021aff`, source hash `aedd0c4725c85794bdc8c91863fb12e6244b4fe1c8449e6678967066957f9ac6`, 1280 by 1811 pixels. Its earlier counterpart `41855a06f9124ec5b9eb63ba7c44adbf` had identical regions but permitted review-labeled cleaning under the old policy.

The caption region is `(731, 362, 157, 96)` and the middle balloon is `(727, 787, 212, 97)`. Both have stroke radius 6. Background extraction used `max(4, stroke_radius * 3)` padding, so it sampled 18 pixels beyond each text rectangle. Those samples included dark frame outlines and artwork outside the white backing.

Replaying feature extraction at radius 6 reproduces the saved scores exactly:

| Region | Background uniformity | Rectangle evidence | Eligibility score | Old action |
| --- | --- | --- | --- | --- |
| Caption | 0.1217837514 | 0.92 | 0.4809810633 | Preserve for review |
| Middle balloon | 0.3820159723 | 0.92 | 0.6241087848 | Preserve for review |

The narrator score combines uniformity and rectangle evidence as `0.55 * uniformity + 0.45 * rectangular_backing`. Both fell below the 0.82 narration gate. The dark external-contour analysis also described the balloon's surrounding dark area as a rectangle rather than recovering the actual light oval interior.

## Fix

`extract_eligibility_features` now tries a bounded light backing measurement. It requires a closed light contour that stays off the crop boundary, has sufficient area, and encloses at least 98% of the region's text-mask pixels. It samples the contour interior excluding the glyph mask and a one-pixel border. Unmasked marks inside the backing still count toward variation. If no such backing exists, the previous feature extraction remains in force.

This changes eligibility evidence, not the detector threshold or removal authorization. Unsupported text is still preserved by the pipeline, and cleaning remains confined to the authorized mask. The service/client policy version is `2.3.1-enclosed-backing`, invalidating prepared results from the previous policy.

## Investigation ledger

1. Matched the screenshots to retained source/clean job assets by image comparison and visual confirmation. Saved records ruled out detection failure: seven regions existed, with the reported two set to review/preserve.
2. Replayed background extraction with stroke radii 2 through 6. Radius 6 reproduced both stored confidence scores exactly; smaller padding recovered near-uniform white samples. This isolated sampling contamination rather than OCR confidence.
3. Tested closed light contours on the actual source. All six white text backings were found, while the unbacked decorative text had no such contour. The affected interior standard deviations were approximately 0.41 and 0.55.
4. Replayed real local detection/refinement with the fix. The caption became narration at 0.995722714; the middle balloon became dialogue at 0.90. All seven regions were eligible.
5. Ran the complete real local detector, LaMa ONNX cleaner and residual verifier on the source. All seven regions finished `repaired`, all residual scores were zero, and changed pixels outside the authorized mask were zero. Existing source/job assets were not replaced. This local replay took about 113 seconds and is not a performance comparison with the previously running application.

## Why it slipped through

The old behavior cleaned review-labeled regions anyway, masking false review classifications. Enforcing preservation exposed those classifications. Existing tests covered enclosure detection and safe preservation, but not a tightly packed caption/balloon whose thick-stroke sampling margin extends beyond its border.

## Validation

- New synthetic caption and ellipse tests check clean eligibility and interior uniformity.
- Public pipeline tests check supported text proceeds, unsupported text remains unchanged, and pixels outside the mask remain identical.
- An open white area cannot gain closed-backing evidence.
- Targeted eligibility and authorization tests passed; the exact real-page pipeline replay passed as described above.
- TypeScript check passed. Full frontend suite: 113 files, 648 tests passed.
- Full Python suite initially returned 162 passed, 3 skipped and 2 failures solely for the old policy-version expectation. Updating those expectations and rerunning both affected files returned 18 passed. No production changes were made after the full-suite run.
- Independent Standards and Spec reviews found no actionable issues in this scoped fix.

Validation covers this page and the automated fixtures. It is not a claim of perfect detection recall across other pages. After restarting the updated local service, the page must be cleaned/translated again to replace its previous displayed result.
