# 0011. Thematic Subtitle Pattern: White Fill with Chromatic Outline

Date: 2026-09-13

## Status

Accepted — extends ADR 0010

## Context

In colored manga, webtoons, and scanlations, floating dialogue, character subtitles, and sound effects placed directly over artwork frequently use thematic colors matching character hair, eye, or aura colors (e.g., cyan/sky blue for one character, magenta/pink for another).

ADR 0010 established the Universal Outline Default and Bidirectional Outline Extraction to ensure all translated text carries a contrasting stroke. However, in practice, rendering colored glyph fills (e.g., solid cyan or solid dark blue letters) over detailed or dark illustrated manga backgrounds still presents readability challenges, particularly with Thai orthography where diacritics and vowel loops can blend into the art.

Professional scanlation and fansub typesetting universally adopts the **Thematic Subtitle Pattern**:
- **Text Fill**: Pure White (`#FFFFFF`) with maximum luminance (100%), ensuring instant human eye focus and effortless readability across all panel scenes.
- **Text Outline**: The character's detected thematic color (e.g., vivid cyan `#65aad6`, magenta `#ff3399`, orange), rendered as a distinct contour (~15% of font size). This preserves the character's visual identity, mood, and original artwork intent while ensuring the white text never blends into light surfaces.

## Decision

1. **Thematic Subtitle Pattern for Chromatic Artwork Text:**
   When translated text is located over artwork (floating text, SFX, overlay subtitles, or non-balloon regions) and contains a detected chromatic color (chroma > 20 in either fill or outline):
   - If the detected fill is chromatic and outline is light/white or matching:
     The colors are mapped to **White Fill (`#FFFFFF`) + Chromatic Outline (`profile.fill`)**.
   - If the detected outline is chromatic and fill is white/light:
     The colors are rendered as **White Fill (`#FFFFFF`) + Chromatic Outline (`profile.outline`)**.
   - The default outline thickness for thematic subtitles is established at **0.15 (15% of font size)**, providing bold character-accent visibility without clogging Thai vowel loops or tone marks.

2. **Preservation of Standard Dialogue Balloons:**
   Standard dialogue within white or light speech balloons (`backgroundLuminance >= 200` with neutral dark text) remains standard dark text (`#000000`) on white. It is not converted to white fill.

3. **Preservation of High-Contrast Dark Outlines:**
   If a text element already has an admitted dark, high-contrast outline (e.g., bright yellow `#ffee00` with solid black outline `#000000`), that authored styling is preserved.

4. **Manual User Overrides:**
   As established in ADR 0006 and ADR 0010, user-applied manual styles (`ownershipMode: "manual"`) are authoritative and never overridden.

## Consequences

- Delivers instant, crisp readability on every manga page matching the professional scanlation aesthetic.
- Fully resolves the illegibility of colored dialogue over dark or variable illustrations.
- Preserves the thematic accent color of every character in the panel.
- 100% backward compatible with speech balloon dialogue and user manual adjustments.
