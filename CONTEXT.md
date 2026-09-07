# Manga Translation Workspace

This context defines the image regions and visual styles used while cleaning and translating manga pages.

## Language

**Text-removal mask**:
The pixels that the cleaner is authorized to replace. Uncertain character artwork stays outside this mask even when that leaves small text remnants.
_Avoid_: Cleaning box, OCR rectangle

**Glyph mask**:
The pixels belonging to the visible shapes of detected letters, including their fill and outline. Artwork elsewhere inside the surrounding text region is not part of the glyph mask.
_Avoid_: Bounding-box mask, crop mask

**Evidence-supported text**:
A text candidate confirmed by a primary text detector or OCR; visual hints such as dark marks on skin are supporting evidence only.
_Avoid_: Tattoo candidate, likely mark

**Text color profile**:
The separately detected fill and outline colors of a glyph. A profile is usable only when its glyph evidence is sufficiently reliable.
_Avoid_: Average crop color, foreground color

**Nearby color profile**:
A reliable text color profile from a neighboring text region on the same page, used only when the current glyph color cannot be determined confidently.
_Avoid_: Nearest pixel color, background fallback

**Reading view**:
The translated manga page shown on its original reading website, where the reader can compare the translation with the original image.
_Avoid_: Full editor, translation workspace

**Translation workspace**:
The full editing environment for inspecting and refining a manga page and its translation. Readers enter this workspace from the reading view when detailed editing is needed.
_Avoid_: Reading overlay, extension popup
