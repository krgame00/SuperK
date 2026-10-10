# 0021. Automated Multi-Page Bubble Layout Optimization and Collision Resolution

Date: 2026-10-10

## Status

Accepted — confirmed by user during `/grill-with-docs` session on 2026-10-10.

## Context

Prior to this decision:
1. Speech boxes detected by Gemini OCR from Japanese manga typically formed narrow vertical bounding strips (e.g., 64px wide). When translated into horizontal Thai, text was compressed into a narrow column, forcing the layout engine to downscale font size to microscopic levels (8px–11px) to prevent overflow.
2. Unconstrained adaptive bubble scaling previously expanded adjacent speech balloons outward into each other (e.g., on Pages 4 and 5 of user manga `SuperK_Translations (137).pdf`), causing overlapping text canvases where dialogue obscured neighboring dialogue and character artwork.
3. While single-page optimization (`[ 🪄 จัดระเบียบ ]`) resolved these issues on the active page, users with multi-page manga documents had to manually visit and click the button on every page one by one.

## Decision

1. **Aspect Ratio Adaptation & Legible Font Floor**:
   - For detected dialogue slots with vertical aspect ratios (`aspectRatio < 0.70`), the engine adapts the search width towards natural manga speech balloon proportions:
     $$\text{targetW} = \max(\text{geom.width}, \min(\text{iw} \times 0.32, \max(\text{round}(\text{geom.height} \times 0.65), \text{round}(\sqrt{\text{area} \times 0.95}))))$$
   - A legible reading floor is enforced:
     $$\text{minFs} = \max(13, \text{round}(\text{iw} \times 0.0115))$$
     (e.g., ~15px–16px on 1280px scans, ~19px–22px on 1700px scans).

2. **Automated Multi-Bubble Collision Resolution (De-Collision)**:
   - Iterative geometric repulsion separates colliding dialogue bubbles along the axis of minimum penetration with a clearance margin (4px–8px).
   - All positions are clamped strictly within page boundaries to prevent bubbles bleeding outside page borders.

3. **Preservation of Manual User Edits (User-Ownership Boundary)**:
   - In accordance with Decision 1 from Round 1 of `/grill-with-docs`, bubbles that have been manually moved, resized, or rotated by the user (flagged with user-modified layout adjustments) are strictly preserved.
   - Batch auto-organization optimizes default/unadjusted bubbles and respects existing user layouts.

4. **Pipeline Timing: Per-Page on Arrival during Batch Translation**:
   - During batch translation ("แปลทั้งเล่ม"), auto-organization runs immediately per-page upon arrival of each translated page.
   - Users navigating pages while translation is underway immediately see clean, legible, non-overlapping bubbles without waiting for the entire document to finish.

5. **Lazy On-Demand Export Cache Invalidation**:
   - Vector coordinates in `bubbleCacheRef` and IndexedDB update immediately across all pages.
   - The interactive DOM overlay (`#pageContainer`) re-renders immediately if the page is currently active.
   - Offscreen rasterized bitmaps for background pages are flagged in `dirtyExportPagesRef` and lazily re-rasterized at export time to maintain low memory usage and eliminate browser stutter.

6. **Dual Entry-Point Accessibility**:
   - **CleaningToolbar (Translated layer)**: The button is upgraded to a compact split/dropdown action `[ 🪄 จัดระเบียบ ⌄ ]` providing immediate access to single-page and all-page optimization.
   - **WorkspaceAdvancedTools ("เครื่องมือ")**: Includes a dedicated `🪄 จัดระเบียบคำแปลทุกหน้า` menu action for whole-book management.

## Consequences

- All manga pages achieve uniform, professional typesetting readability and zero-overlap dialogue spacing automatically.
- User-customized bubble arrangements are never overwritten by automated batch routines.
- Export caches remain accurate and fresh upon PDF/ZIP generation without incurring background rendering overhead during active reading.
