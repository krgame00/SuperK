# Skip UI Text During Cleaning and Translation

## Goal

Preserve interface-like text that is not part of the story, while continuing to clean and translate dialogue, thoughts, and narration—including narration without a speech bubble.

## Scope

The system must skip HUD elements, menus, button labels, status values, counters, watermarks, credits, and small scattered labels. SFX remains preserved under the existing policy.

The system must continue processing:

- spoken dialogue;
- character thoughts;
- narration and story captions, even when they have no bubble;
- manual bubbles explicitly created by the user.

## Design

### Cleaning policy

- Preserve every detected region on pages classified as `credits`.
- On `ui` and `unknown` pages, classify each region independently: clean confident dialogue and narration, while preserving small low-confidence interface labels.
- Preserve `sfx` and protected regions as before.
- On comic pages, continue cleaning confident `dialogue` and `narration` regions.
- Do not automatically clean every low-confidence `review` region. Preserve review regions that look like small, isolated interface labels rather than sentence-bearing story text.
- Keep a conservative path for sentence-like review regions so narration without a bubble is not lost.
- Manual mask edits remain the explicit override when automatic classification is wrong.

The mixed-page review rule should use existing geometric features and page-relative measurements. It must not depend on a fixed pixel size, because source resolutions vary.

### Translation policy

- Gemini reads the Original image and renders accepted translations on the Clean image, preserving the existing dual-source workflow.
- The translation prompt must request only dialogue, thoughts, and narration.
- Remove instructions that force extraction of all floating/background text or a specific colored text area.
- Explicitly exclude UI, HUD, menus, button labels, character/stat labels, counters, credits, watermarks, and SFX.
- A valid response with no story text remains a successful clean-only result.

### Data flow

1. The cleaning service classifies the page and each detected region.
2. Credit pages and interface-like review regions are preserved.
3. Dialogue and narration regions are cleaned, including on pages classified as `ui` or `unknown`.
4. Gemini examines the Original and returns only story-bearing text boxes.
5. The client renders those boxes on the Clean background and caches by Original URL.

## Error handling

- Classification uncertainty favors preserving the original pixels.
- API, malformed-response, and local rendering failures remain failures and must not be converted to no-text success.
- Clean/Original dimension mismatch remains a cleaning failure.
- Manual bubbles still render even when Gemini returns no automatic bubbles.

## Testing

- Credit pages remain pixel-identical after automatic cleaning.
- UI and unknown pages clean confident story text while preserving small interface labels.
- A mixed comic/UI page preserves small scattered labels but cleans confident dialogue.
- Standalone narration without a bubble is still cleaned and translated.
- The translation prompt excludes UI/HUD/watermark text and no longer forces all floating/background text.
- SFX remains uncleaned and untranslated.
- A page containing only UI/SFX completes without translation overlays or a failure summary.
- Existing dual-source, cache, manual-bubble, TypeScript, production-build, and smoke checks continue to pass.

## Non-goals

- Translating game interfaces or credits.
- Perfect semantic classification of every decorative text style.
- Removing the existing Mask Editor or manual override workflow.
