# 20: Background-Aware Binary Readability Gate

**What to build:** Make Binary Fill remain adaptive to the actual cleaned background. The preferred luminance-based mapping is only a starting candidate; final admission must evaluate the Inpainted clean background under the Translated glyph footprint and choose the stronger white/black result when the preferred pair would disappear.

**Blocked by:** 18: Binary Fill Readable Foundation; 19: Brightness Classification & Outline Strengthening.

**Status:** closed

- [x] Binary Fill evaluates the Inpainted clean background beneath the Translated glyph footprint plus the established readability margin rather than relying on the whole OCR box.
- [x] A preferred source-luminance mapping can be rejected when it fails local readability.
- [x] The alternate binary fill direction remains eligible after preferred-pair rejection, while fill stays strictly white or black.
- [x] A white or near-white speech balloon never accepts a white-on-white fallback when a stronger black-fill candidate exists.
- [x] A dark panel never accepts black-on-dark fallback when a stronger white-fill candidate exists.
- [x] Mixed bright/dark backgrounds are evaluated across multiple samples, including weak local regions, so a good average cannot hide a disappearing section of text.
- [x] Existing approximate readability goals remain observable: roughly 4.5:1 across most relevant samples and avoidance of materially weak regions around 3:1 when a stronger candidate exists.
- [x] Source-accent outline is retained when it passes; an unreadable accent may be strengthened or replaced by a safe neutral outline without introducing chromatic fill.
- [x] Outline width may use the existing proportional escalation/capping behavior when necessary, without clogging Thai glyph counters or tone marks.
- [x] Controlled halo/shadow and category-specific plate behavior remain later escalation stages rather than being applied by default.
- [x] Style/readability failure remains non-fatal and retains explicit fallback/review provenance.
- [x] Tests cover white, dark, pastel-accent, and mixed-background behavior through resolved-style output rather than private scoring internals.

