# Source-matched text size

## Intent and approved decisions

Match translated lettering's visible size to the original lettering at the same page scale, rather than matching the original block dimensions, line count or nominal font px value. Default new translations to this behavior; existing saved work requires an explicit command. Preserve user-adjusted text sizes until the user explicitly returns them to automatic sizing.

## Evidence and sizing

- Recover a representative original glyph/line height from the original pre-clean image and confirmed text evidence. Do not treat the OCR rectangle, mask bounding box, line count, cleaning mask or surrounding artwork as a direct font-size measurement.
- Keep size evidence separate from source color/effect confidence. Record original image/region identity, measurement quality and representative visible size in page-image coordinates. Reuse valid measurements; image/region changes invalidate them.
- Resolve the actual selected font after it is loaded and use its visible glyph metrics to choose a translated font size. Account for diacritics and the selected language. Outline and drop shadow must not inflate the inferred body-letter size. Re-evaluate automatic sizing after an explicit font change; preserve manual ownership.
- Attempt dialogue, captions, text over artwork, rotated/vertical text and SFX using evidence appropriate to the writing direction. Unsupported or unreliable measurement uses the existing sizing strategy as a temporary fallback labeled “ยังเทียบขนาดต้นฉบับไม่ได้”; do not claim successful matching.
- Reliable small source lettering keeps its source-matched size even below the existing readable-size floor, with the normal readability warning and manual enlargement available. Explicit user size multipliers are user changes, not proof that the resulting visible text still matches the source.

## Layout and ownership

- Longer translations wrap at complete-word boundaries while retaining their chosen size. Accommodate height only within authorized available layout space; report overflow when unresolved instead of shrinking the font or silently expanding over other text/art.
- Limit automatic height accommodation to reliable original balloon/text-space boundaries. If those boundaries are unknown, preserve the existing layout space and report overflow. Explicit user-adjusted layout space remains authoritative. This limit applies to automatic source-size accommodation and does not redefine the separation of side reflow from corner scaling.
- Retain the separate text layout area and tight selection frame. Matching size does not reset text placement, rotation, width, manual height floor, color or effects.
- Side-width dragging retains visible font size and performs live reflow. Corner dragging remains proportional scaling and makes the resulting size user-owned. Direct size adjustments also become user-owned; mere movement/rotation/width reflow does not opt out of automatic source size.
- An explicit sizing action on old work offers current point/page/book scope and excludes manual-sized points by default. Restoring Auto for a manually sized point requires explicit selection. Record old values for Undo/Redo; undo restores evidence/ownership with size.
- Persist chosen base size, ownership and measurement provenance. Reopen, preview, export and extension consume the same resolved size; zoom never changes the saved page-coordinate size. Legacy locked targetFontSize is not original measurement evidence and must not be interpreted as such.

## Integration and performance

Source analysis happens during preparation/explicit sizing, never inside pointermove, drag preview or ordinary selection. Cache actual-font metrics and invalidate them for font/text/source changes. The companion dense-page interaction work must remain smooth after this feature is integrated.

## Considered approaches

1. Chosen: original glyph evidence plus loaded-font visible metrics; supports meaningful visual matching, with explicit uncertainty and fallback.
2. Reuse source region height as font size: simpler, but confuses multiline/vertical layout and padding with actual letter size.
3. Preserve region-fitting alone and offer a manual size control: keeps current behavior but does not achieve automatic source matching.

## Acceptance

- Controlled reliable fixtures target visible body-letter height within 10% of the original at the same image scale; smaller-than-one-pixel differences are treated as rounding. Report measured error rather than claiming all fonts and originals match perfectly.
- Tests distinguish original line/letter height from whole mult-line region height and exclude border/shadow/artwork inflation. Include Thai diacritics, Latin, horizontal/vertical source, rotation, small letters, low-confidence/blurred source and SFX fallback.
- New automatic sizing, explicit old-work application, manual preservation, return-to-Auto, font changes, no-op selection, Undo/Redo and source revision invalidation are covered.
- Long translations keep font size, whole words and overflow visibility. Side and corner handle contracts remain intact.
- Browser verification compares visible glyphs at 44%, 100% and another zoom, and compares preview/export/reopened/extension output. Use original-coordinate measurements, not screenshots of different zooms as if they were comparable.
- Confirm paired dense-page performance with source sizing enabled. No real provider requests are necessary for automated fixtures.
