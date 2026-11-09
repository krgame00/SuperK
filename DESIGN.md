# Design System

## Theme Strategy
**Restrained Dark Mode**: Sleek, elegant, and minimalist. The interface fades into the background so the manga page remains the hero. We use pure neutral darks without warm/cool tints to keep it looking professional and tool-like.

## Color Palette (OKLCH)

```css
:root {
  /* Architectural */
  --bg: oklch(0.10 0 0); /* Pure near-black */
  --surface: oklch(0.15 0 0); /* Slightly lighter for panels */
  --surface-hover: oklch(0.20 0 0);
  
  /* Text */
  --ink: oklch(0.98 0 0); /* Crisp white */
  --muted: oklch(0.65 0 0); /* Secondary text */
  
  /* Brand (Seed: 356.8 - Pure Red) */
  --primary: oklch(0.65 0.18 356.8); /* Elegant deep red */
  --primary-hover: oklch(0.70 0.18 356.8);
  --primary-content: oklch(0.98 0 0); /* White text on primary */
  
  /* Accent */
  --accent: oklch(0.85 0.05 200); /* Desaturated cool blue for subtle contrast */
  --accent-hover: oklch(0.90 0.05 200);
  
  /* Status */
  --success: oklch(0.65 0.15 150);
  --error: oklch(0.60 0.18 25);
}
```

## Typography
- **Font**: Inter (or system sans-serif). Clean, geometric, legible.
- **Hierarchy**:
  - H1: 24px, medium weight, tracking -0.02em (no shouting).
  - Body: 14px, regular, leading 1.5.
  - Micro: 12px, medium, uppercase only for specific tiny labels.

## Layout & Components
- **Canvas-first**: The main area is an edge-to-edge or softly padded canvas for the image.
- **Floating Controls**: Actions float cleanly over or below the image rather than sitting inside heavy card blocks.
- **Borders & Radii**: Very restrained. 8px (0.5rem) max border radius for buttons/panels. 1px solid borders using `--surface-hover` for subtle separation.
- **Motion**: Instant or very snappy transitions (150ms ease-out) for hover states. No bouncy or elastic animations.

## Anti-patterns Avoided
- No glassmorphism as a default.
- No heavy drop shadows on cards.
- No "cream/warm" background tint.
