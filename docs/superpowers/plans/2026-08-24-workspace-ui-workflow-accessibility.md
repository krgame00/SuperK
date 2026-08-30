# SuperK Manga Translator — Workspace UI & Accessibility Master Plan

> **Date:** 2026-08-24 / 2026-08-30  
> **Standard:** WCAG 2.2 Level A & AA + Product Design System  
> **Status:** Active Execution (Task 9)

---

## 1. Executive Summary & Goals

This document consolidates the accessibility audit, design token architecture, component redesign, and Task 9 regression verification for **SuperK Manga Translator**. It bridges the visual and semantic requirements to ensure the workspace UI provides:

1. **Content-First Canvas**: Dark slate theme where manga artwork remains the focal point without competing high-contrast clutter.
2. **WCAG 2.2 Level AA Compliance**: Contrast ratios ≥ 4.5:1 for normal text and ≥ 3:1 for graphical components, minimum 24×24px (and 40–44px for primary) touch targets, non-color-reliant state indicators, and complete ARIA semantics.
3. **Ergonomic Workflow**: Unified top header, consolidated export dropdown, floating contextual cleaning bar, viewport-safe menus, and smooth thumbnail filmstrip.

---

## 2. Accessibility & Design Token System

### 2.1 OKLCH Design Tokens (`src/app/globals.css`)
```css
:root {
  /* Restrained Dark Mode Slate Palette */
  --bg: oklch(0.12 0.01 260);             /* Deep charcoal-slate background */
  --surface: oklch(0.16 0.01 260);        /* Elevated panels & toolbars */
  --surface-hover: oklch(0.22 0.01 260);  /* Interactive hover states */
  --surface-active: oklch(0.26 0.02 260); /* Active/pressed state */
  
  --border: oklch(0.24 0.01 260);         /* Subtle structural borders */
  --border-subtle: oklch(0.20 0.01 260);
  
  --ink: oklch(0.95 0 0);                 /* Crisp primary foreground text */
  --muted: oklch(0.70 0.01 260);          /* Secondary text (≥4.5:1 contrast) */
  --muted-dark: oklch(0.48 0.01 260);     /* Disabled states */
  
  /* Brand Primary: SuperK Vibrant Crimson/Magenta */
  --primary: oklch(0.64 0.23 352);
  --primary-hover: oklch(0.69 0.23 352);
  --primary-content: oklch(0.99 0 0);     /* White text on primary button */
  
  --background: var(--bg);
  --foreground: var(--ink);
}
```

### 2.2 Touch Targets & Focus Indicators
- **Standard Action Height**: `h-8.5` (34–36px) with generous horizontal padding (`px-3.5`).
- **Primary CTA Buttons**: `h-8.5` with high visual weight and `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1`.
- **Canvas Floating Controls**: Circular prev/next buttons sized at `h-11 w-11 sm:h-12 sm:w-12` (44×44px minimum).
- **Global Focus Ring**: Unified focus outline using `--primary` with dark offset ring.

---

## 3. Tasks 1–8 Summary & Implementation

- **Top Navigation Bar**: Semantic heading `<h1>`, unified utilities group with `aria-label`s on every icon button, primary translation CTA, and consolidated export menu.
- **Cleaning Toolbar**: Semantic `role="tablist"` with `role="tab"` buttons, `aria-selected`, and clear progress and error states.
- **Thumbnail Filmstrip**: Keyboard navigable with `onFocus -> scrollIntoView`, checkmark badge for non-color state indication, and high-contrast captions.
- **Page Canvas**: Responsive scaling and touch targets conforming to WCAG 2.2 Level AA.

---

## 4. Task 9: Responsive, Failure-State, and Full Regression Verification

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `components/workspace/WorkspacePrimaryAction.tsx`
- Modify: `components/workspace/WorkspaceMenu.tsx`
- Modify: `components/workspace/WorkspaceAdvancedTools.tsx`
- Modify: `components/workspace/WorkspaceExportMenu.tsx`
- Modify: `tests/workflow/WorkspacePage.test.tsx`
- Modify: `tests/workflow/WorkspaceControls.test.tsx`

**Interfaces:**
- Consumes: all components and state introduced in Tasks 1–8.
- Produces: desktop/tablet header, mobile bottom editing compatibility, viewport-safe menus, stable error/retry messaging, and final verified build.

### Steps:
- [ ] **Step 1: Add failing responsive and failure-state tests**
  - At one breakpoint presentation, exactly one enabled primary workflow button is accessible.
  - Advanced/export triggers expose `aria-expanded` and do not disappear when the viewport width is 375 pixels.
  - A cleaning error is rendered with `role="alert"` and a retry-capable primary action.
  - Batch partial failure keeps the `ส่งออก` action for successful current pages and exposes `ลองใหม่ N หน้าที่พลาด` in advanced tools.
  - Mobile editing dock and thumbnail region do not share the same fixed bottom offset class.

- [ ] **Step 2: Run focused tests and prove the remaining gaps**
  - Run: `npm test -- tests/workflow/WorkspacePage.test.tsx tests/workflow/WorkspaceControls.test.tsx`
  - Expected: at least one new assertion fails before responsive/failure polish.

- [ ] **Step 3: Finish responsive and error-state behavior**
  - Keep the CTA label untruncated; move advanced controls into the menu before compressing it.
  - Clamp menus with `max-h-[min(70vh,24rem)] overflow-y-auto`.
  - Ensure mobile uses one primary CTA and that the overlay editing dock reserves space above the visible thumbnail strip.
  - Add `role="alert"` only to terminal errors, while ongoing progress remains `role="status"`/`aria-live="polite"`.
  - Remove pulsing failure animation and use a static high-contrast indicator.

- [ ] **Step 4: Run the complete test suite**
  - Run: `npm test`
  - Expected: all Vitest suites PASS with no unhandled rejection.

- [ ] **Step 5: Run lint and type-check**
  - Run: `npm run lint` & `npx tsc --noEmit`
  - Expected: both commands exit 0.

- [ ] **Step 6: Run the production build**
  - Run: `npm run build`
  - Expected: Next.js production compilation, type validation, and route generation complete successfully with exit code 0.

- [ ] **Step 7: Inspect the final diff and commit**
  - Run: `git diff --check`, `git status --short`, `git diff --stat`

---

## 5. Completion Evidence

The implementation handoff must report:
- The final Vitest test count and exit code.
- Lint exit code and any pre-existing warnings.
- TypeScript `--noEmit` exit code.
- Next.js production build exit code.
- A short manual verification note for desktop, tablet, and mobile viewport behavior.
- Any spec acceptance criterion not completed; do not describe the work as complete while one remains.
