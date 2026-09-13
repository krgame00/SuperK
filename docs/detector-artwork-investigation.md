# Artwork candidates passing the detector

Status: Completed — Text authorization boundary implemented and validated across detector, eligibility, cleaning, translation selection, review controls, and export confirmation.

## Accepted behavior

The user accepted all five recommendations in the design interview:

1. Preserve uncertain regions and mark them for review while continuing work on confident regions.
2. Keep uncertain candidates inspectable, but do not automatically remove or translate them before confirmation.
3. Continue supporting sound effects, decorative lettering, and isolated glyphs over artwork. Insufficient evidence means review, not categorical rejection.
4. For reviewed candidates, confirming that text exists does not approve its removal mask. Show the proposed mask and allow correction or explicit mask approval before cleaning.
5. Allow explicit export acceptance of the current page with uncertain regions preserved. Export acceptance does not trigger additional cleaning. Dismissing a warning is not acceptance.

## Implementation mismatch found during design

`classify_eligibility` currently returns `TextRole.REVIEW` with `AutomaticAction.CLEAN` on some branches. A review label therefore does not itself prevent cleaning. The accepted behavior requires an actual authorization boundary, not merely a new label or a detector threshold adjustment.

The page export confirmation currently accepts the existing page state without rerunning cleaning, which matches the accepted separation of responsibilities. However, the per-page warning dismiss button also adds the page to `confirmedPages`; that behavior conflicts with decision 5.

## Observed path

`HybridTextDetector.detect` rejects a CTD block only when both its confidence is below 0.60 and its seed coverage is below 0.04. Surviving blocks become CTD evidence regions. Subsequent stroke extraction and dilation can turn weak seed support into a larger output mask with values of 0.95.

## Experiment ledger

Input: 100 by 100 white RGB image with one black vertical stroke at rows 30:70, columns 49:51. Stubbed CTD output: one 60 by 60 block at (20, 20), probability 0.30 on the stroke and zero elsewhere. Paddle disabled. Only block confidence changes.

| Block confidence | Output blocks | Nonzero mask pixels | Evidence regions |
| --- | --- | --- | --- |
| 0.59 | 0 | 0 | 0 |
| 0.60 | 1 | 164 | 1 |
| 0.90 | 1 | 164 | 1 |

This differential confirms that crossing the confidence boundary admits the same sparse stroke through this detector path. It does not establish that a real CTD model assigns those scores to the reported image, or that downstream cleaning changes all these pixels. A lone stroke may also be a legitimate glyph, so removing every such candidate is not a safe general fix.

## Implementation direction

Separate candidate detection from permission to erase. On artwork, uncertain candidates should remain available for review without becoming automatic text-removal evidence. Preserve raw model confidence separately from constructed mask support. Validate independent glyph or recognition evidence before expanding a suspicious candidate. Avoid an unconditional AND-to-OR change, which could reject short legitimate text.

Future regression coverage should include non-text curves and seams, real isolated glyphs, outlined colored text, and text touching artwork, measuring both artwork preservation and retained text recall.

## Acceptance criteria

- An uncertain candidate remains inspectable and does not enter automatic removal or cloud translation. Confident regions on the same page continue processing.
- A review label cannot coexist with permission to automatically erase an unconfirmed candidate. Retries and residual-mask expansion must obey the same boundary.
- Confirming text alone leaves the image unchanged; cleaning a reviewed candidate requires inspection and approval of its proposed mask.
- Pixels outside the authorized removal mask remain unchanged by cleaning.
- Isolated glyphs, decorative text, and sound effects are not discarded solely because of their category or shape.
- Explicit page export acceptance can export the preserved current state without invoking cleaning. Closing a warning does not confirm export.
- Existing page-revision invalidation continues to require fresh export acceptance after image or translation changes.

## Remaining engineering work

Trace and implement the authorization boundary across detection, eligibility, cleaning, translation selection, review controls, and export confirmation; preserve compatibility with stored results. Choose numeric thresholds using positive and negative fixtures rather than inferring values from the synthetic confidence-boundary example. Validate the actual screenshot case when its original model output becomes available.
