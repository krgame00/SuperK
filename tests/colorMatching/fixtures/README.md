# Text Color Matching Test Fixtures

This directory contains specifications and synthetic generator patterns for validating automatic manga text color extraction across various art styles:

1. **Monochrome B&W Text**: High-contrast black text (`#000000`) inside a white speech bubble with white/light outer outline.
2. **Vibrant Colored Text**: Non-black dialogue styling (e.g. pink `#ff2a85`, cyan `#00c8ff`, red `#e11d48`) commonly used for special voices, shouts, or magical dialogue.
3. **Outlined & Glow Text**: Colored glyphs with contrasting outer stroke rings or dark shadows.
4. **Low-Contrast Grayscale Text**: Ambiguous low-contrast background regions that safely trigger fallback to global default styles (`fillConfidence < 0.65`).
