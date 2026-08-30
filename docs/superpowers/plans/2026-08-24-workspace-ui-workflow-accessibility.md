# Workspace UI Workflow and Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the manga workspace one state-aware page action, live non-obscuring bubble editing, and complete keyboard access for translated bubbles and Mask Editor.

**Architecture:** Keep `useCleaning` and `useTranslation` as the owners of asynchronous work, add a pure UI-state derivation module, and extract focused header controls from the large workspace page. Keep canvas text rendering in `translationOverlay`, but route pointer and keyboard edits through the same mutations and undo records; keep mask painting in `MaskEditor`, but add a local modal-focus contract and keyboard brush cursor.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, Vitest 4, Testing Library, vanilla DOM/canvas overlay code.

**Spec:** `docs/superpowers/specs/2026-08-24-workspace-ui-workflow-accessibility-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` and `node_modules/next/dist/docs/03-architecture/accessibility.md` before editing React UI code; this repository's Next.js version differs from remembered APIs.
- Add no runtime or test dependency.
- Preserve current cleaning/translation API payloads, persistence formats, canvas text-fitting behavior, pointer interactions, batch translation, layer behavior, and all five export formats.
- Use Thai for general user-facing labels; keep cleaner/engine identifiers unchanged where technical precision matters.
- Bubble keyboard movement uses source-image pixels: arrows `1`, Shift+arrows `10`; Alt switches movement to bottom/right resize.
- Touch targets are at least 44 by 44 CSS pixels on touch layouts, and every icon-only control has an accessible name and visible focus style.
- Motion respects `prefers-reduced-motion`; no action may require hover.
- Preserve pre-existing worktree changes. Before each commit, inspect `git diff -- <task files>` and stage only the task's intended files/hunks.
- Every task follows red-green-refactor: add the focused failing test, prove the expected failure, add the smallest implementation, then run the focused suite.
- Final verification is exactly `npm.cmd test`, `npm.cmd run lint`, `npx.cmd tsc --noEmit`, and `npm.cmd run build`; all four commands must exit 0.

## File Structure

### Create

- `lib/workspacePrimaryAction.ts` — pure page-state-to-primary-action derivation.
- `components/workspace/WorkspacePrimaryAction.tsx` — the single dominant CTA and busy/cancel presentation.
- `components/workspace/WorkspaceMenu.tsx` — accessible menu trigger, focus, Escape, and viewport-safe shell shared by advanced tools and export.
- `components/workspace/WorkspaceAdvancedTools.tsx` — manual Clean, Mask editing, and batch translation controls.
- `components/workspace/WorkspaceExportMenu.tsx` — five existing export commands under one control.
- `tests/workflow/workspacePrimaryAction.test.ts` — exhaustive pure-state matrix.
- `tests/workflow/WorkspaceControls.test.tsx` — component interaction and accessibility tests for CTA and menus.

### Modify

- `src/app/page.tsx` — derive workflow state, connect the primary CTA, track review entry per page, connect advanced/export controls, and remove competing duplicate actions.
- `components/cleaning/CleaningToolbar.tsx` — retain layer selection and cleaning status; move manual operation buttons to advanced tools.
- `lib/translationOverlay.ts` — keep rendered text visible, add anchored live editing, focusable bubble wrappers, shared keyboard mutations, and single-session undo.
- `components/cleaning/MaskEditor.tsx` — modal focus management, keyboard cursor/painting, live status, and touch targets.
- `tests/workflow/WorkspacePage.test.tsx` — clean-before-translate, failure, review, advanced actions, exports, and responsive integration.
- `tests/cleaning/CleaningToolbar.test.tsx` and `tests/cleaning/CleaningToolbar.layers.test.tsx` — layer-only toolbar contract.
- `tests/cleaning/translationOverlay.test.ts` — live editor and bubble keyboard regressions.
- `tests/cleaning/MaskEditor.test.tsx` — modal and keyboard-canvas regressions.

---

### Task 1: Pure primary-action state model

**Files:**
- Create: `lib/workspacePrimaryAction.ts`
- Create: `tests/workflow/workspacePrimaryAction.test.ts`

**Interfaces:**
- Consumes: page availability, valid Clean/translation availability, review-entry state, cleaning/translation busy state, workflow phase.
- Produces:

```ts
export type WorkspacePrimaryActionKind =
  | "disabled"
  | "prepare-and-translate"
  | "translate"
  | "review"
  | "export"
  | "busy";

export interface WorkspacePrimaryActionState {
  kind: WorkspacePrimaryActionKind;
  label: string;
  disabled: boolean;
  cancellable: boolean;
}

export interface WorkspacePrimaryActionInput {
  hasPage: boolean;
  hasCleanResult: boolean;
  hasTranslation: boolean;
  hasEnteredReview: boolean;
  isCleaning: boolean;
  isTranslating: boolean;
  workflowPhase: "cleaning" | "translating" | null;
  cancellable: boolean;
}
export function getWorkspacePrimaryAction(
  input: WorkspacePrimaryActionInput,
): WorkspacePrimaryActionState;
```

- [ ] **Step 1: Read the installed Next.js UI and accessibility guides**

Run:

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
Get-Content -Raw node_modules/next/dist/docs/03-architecture/accessibility.md
```

Expected: both files describe the installed Next.js behavior; no online documentation is substituted.

- [ ] **Step 2: Write the failing state-matrix tests**

Create a table-driven test covering all precedence rules:

```ts
import { describe, expect, test } from "vitest";
import {
  getWorkspacePrimaryAction,
  type WorkspacePrimaryActionInput,
} from "@/lib/workspacePrimaryAction";

const ready: WorkspacePrimaryActionInput = {
  hasPage: true,
  hasCleanResult: false,
  hasTranslation: false,
  hasEnteredReview: false,
  isCleaning: false,
  isTranslating: false,
  workflowPhase: null,
  cancellable: false,
};

describe("getWorkspacePrimaryAction", () => {
  test.each([
    [{ ...ready, hasPage: false }, "disabled", "เตรียมและแปลหน้านี้", true],
    [ready, "prepare-and-translate", "เตรียมและแปลหน้านี้", false],
    [{ ...ready, hasCleanResult: true }, "translate", "แปลหน้านี้", false],
    [{ ...ready, hasTranslation: true }, "review", "ตรวจแก้คำแปล", false],
    [{ ...ready, hasTranslation: true, hasEnteredReview: true }, "export", "ส่งออก", false],
    [{ ...ready, isCleaning: true, workflowPhase: "cleaning" }, "busy", "กำลังคลีน…", true],
    [{ ...ready, isTranslating: true, workflowPhase: "translating" }, "busy", "กำลังแปล…", true],
  ] as const)("derives %#", (input, kind, label, disabled) => {
    expect(getWorkspacePrimaryAction(input)).toMatchObject({ kind, label, disabled });
  });

  test("only exposes cancel while busy and cancellation is supported", () => {
    expect(getWorkspacePrimaryAction({
      ...ready,
      isTranslating: true,
      workflowPhase: "translating",
      cancellable: true,
    }).cancellable).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test and prove it fails for the missing module**

Run: `npm.cmd test -- tests/workflow/workspacePrimaryAction.test.ts`

Expected: FAIL because `@/lib/workspacePrimaryAction` does not exist.

- [ ] **Step 4: Implement the pure precedence function**

Implement busy first, then no-page, translation/review, Clean-ready, and first-run states. `hasTranslation` takes precedence over `hasCleanResult`; a stale `hasEnteredReview` without a translation must not produce Export.

```ts
export function getWorkspacePrimaryAction(
  input: WorkspacePrimaryActionInput,
): WorkspacePrimaryActionState {
  if (input.isCleaning || input.isTranslating) {
    const cleaning = input.workflowPhase === "cleaning" || input.isCleaning;
    return {
      kind: "busy",
      label: cleaning ? "กำลังคลีน…" : "กำลังแปล…",
      disabled: true,
      cancellable: input.cancellable,
    };
  }
  if (!input.hasPage) {
    return { kind: "disabled", label: "เตรียมและแปลหน้านี้", disabled: true, cancellable: false };
  }
  if (input.hasTranslation) {
    return input.hasEnteredReview
      ? { kind: "export", label: "ส่งออก", disabled: false, cancellable: false }
      : { kind: "review", label: "ตรวจแก้คำแปล", disabled: false, cancellable: false };
  }
  if (input.hasCleanResult) {
    return { kind: "translate", label: "แปลหน้านี้", disabled: false, cancellable: false };
  }
  return { kind: "prepare-and-translate", label: "เตรียมและแปลหน้านี้", disabled: false, cancellable: false };
}
```

- [ ] **Step 5: Run focused tests and commit**

Run: `npm.cmd test -- tests/workflow/workspacePrimaryAction.test.ts`

Expected: PASS.

```powershell
git add lib/workspacePrimaryAction.ts tests/workflow/workspacePrimaryAction.test.ts
git commit -m "feat: model workspace primary action"
```

---

### Task 2: Dominant primary-action component

**Files:**
- Create: `components/workspace/WorkspacePrimaryAction.tsx`
- Create: `tests/workflow/WorkspaceControls.test.tsx`

**Interfaces:**
- Consumes: `WorkspacePrimaryActionState`, `onAction`, optional `onCancel`.
- Produces:
```ts
interface WorkspacePrimaryActionProps {
  state: WorkspacePrimaryActionState;
  onAction: () => void;
  onCancel?: () => void;
}

export function WorkspacePrimaryAction(
  props: WorkspacePrimaryActionProps,
): React.ReactElement;
```

- [ ] **Step 1: Write failing CTA interaction tests**

```tsx
test("renders one dominant action and dispatches its current state", () => {
  const onAction = vi.fn();
  render(<WorkspacePrimaryAction
    state={{ kind: "review", label: "ตรวจแก้คำแปล", disabled: false, cancellable: false }}
    onAction={onAction}
  />);
  fireEvent.click(screen.getByRole("button", { name: "ตรวจแก้คำแปล" }));
  expect(onAction).toHaveBeenCalledOnce();
});

test("announces busy state and exposes cancel only when supported", () => {
  const onCancel = vi.fn();
  render(<WorkspacePrimaryAction
    state={{ kind: "busy", label: "กำลังแปล…", disabled: true, cancellable: true }}
    onAction={vi.fn()}
    onCancel={onCancel}
  />);
  expect(screen.getByRole("status")).toHaveTextContent("กำลังแปล");
  fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
  expect(onCancel).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Prove the component tests fail**

Run: `npm.cmd test -- tests/workflow/WorkspaceControls.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the CTA**

Render one primary button for non-busy states. For busy state, render the disabled progress-labelled button inside `role="status"` and render a separate `ยกเลิก` button only when both `state.cancellable` and `onCancel` are present. Use `motion-reduce:animate-none`, a visible `focus-visible` outline, and a minimum mobile height of `h-11`.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm.cmd test -- tests/workflow/WorkspaceControls.test.tsx`

Expected: PASS for the two CTA tests.

```powershell
git add components/workspace/WorkspacePrimaryAction.tsx tests/workflow/WorkspaceControls.test.tsx
git commit -m "feat: add workspace primary action"
```
```

---

### Task 3: Accessible advanced-tools and export menus

**Files:**
- Create: `components/workspace/WorkspaceMenu.tsx`
- Create: `components/workspace/WorkspaceAdvancedTools.tsx`
- Create: `components/workspace/WorkspaceExportMenu.tsx`
- Modify: `tests/workflow/WorkspaceControls.test.tsx`

**Interfaces:**

```ts
export interface WorkspaceMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface WorkspaceMenuProps {
  label: string;
  items: WorkspaceMenuItem[];
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export type WorkspaceExportKind = "image" | "pdf" | "strip" | "zip" | "cbz";

interface WorkspaceExportMenuProps {
  disabled: boolean;
  onExport: (kind: WorkspaceExportKind) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

interface WorkspaceAdvancedToolsProps {
  canClean: boolean;
  canEditMask: boolean;
  busy: boolean;
  batchFailureCount: number;
  onClean: () => void;
  onEditMask: () => void;
  onTranslateBook: () => void;
  onRetryFailedPages: () => void;
}
```

- [ ] **Step 1: Add failing menu accessibility tests**

Test these exact behaviors:

```tsx
test("export menu contains every existing format", () => {
  const onExport = vi.fn();
  render(<WorkspaceExportMenu disabled={false} onExport={onExport} />);
  const trigger = screen.getByRole("button", { name: "ส่งออก" });
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  for (const name of ["รูปภาพหน้านี้", "PDF", "Strip", "ZIP", "CBZ"]) {
    expect(screen.getByRole("menuitem", { name })).toBeVisible();
  }
  fireEvent.click(screen.getByRole("menuitem", { name: "CBZ" }));
  expect(onExport).toHaveBeenCalledWith("cbz");
  expect(trigger).toHaveFocus();
});

test("menu closes on Escape and restores trigger focus", () => {
  render(<WorkspaceAdvancedTools
    canClean canEditMask busy={false} batchFailureCount={0}
    onClean={vi.fn()} onEditMask={vi.fn()}
    onTranslateBook={vi.fn()} onRetryFailedPages={vi.fn()}
  />);
  const trigger = screen.getByRole("button", { name: "เครื่องมือขั้นสูง" });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
```

- [ ] **Step 2: Run and prove the tests fail**

Run: `npm.cmd test -- tests/workflow/WorkspaceControls.test.tsx`

Expected: FAIL for missing menu components.

- [ ] **Step 3: Implement `WorkspaceMenu`**

Use `useId()` for the menu id, `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`. On open, focus the first enabled item. ArrowDown/ArrowUp wrap among enabled items; Home/End jump; Escape closes and restores trigger focus. Selecting an item closes first, restores focus, then calls `onSelect`. Position the menu with right alignment and `max-w-[calc(100vw-1rem)]`; do not add a portal or dependency.

- [ ] **Step 4: Implement advanced and export wrappers**

`WorkspaceAdvancedTools` maps to these items in this order: `คลีนข้อความใหม่`, `แก้ Mask`, `แปลทั้งเล่ม`, then `ลองใหม่ N หน้าที่พลาด` only when `batchFailureCount > 0`. `WorkspaceExportMenu` maps the five labels to `image`, `pdf`, `strip`, `zip`, and `cbz` without changing the underlying handlers.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm.cmd test -- tests/workflow/WorkspaceControls.test.tsx`

Expected: PASS.

```powershell
git add components/workspace/WorkspaceMenu.tsx components/workspace/WorkspaceAdvancedTools.tsx components/workspace/WorkspaceExportMenu.tsx tests/workflow/WorkspaceControls.test.tsx
git commit -m "feat: group workspace advanced and export actions"
```

---

### Task 4: Integrate the clean-translate-review-export workflow

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `components/cleaning/CleaningToolbar.tsx`
- Modify: `tests/workflow/WorkspacePage.test.tsx`
- Modify: `tests/cleaning/CleaningToolbar.test.tsx`
- Modify: `tests/cleaning/CleaningToolbar.layers.test.tsx`

**Interfaces:**
- Consumes: `getWorkspacePrimaryAction`, the three workspace controls, current `useCleaning` and `useTranslation` return values.
- Produces: one header CTA; page-local review-entry tracking; advanced manual actions; unchanged export callbacks.
- `CleaningToolbarProps` becomes layer/status-only:

```ts
interface CleaningToolbarProps {
  hasResult: boolean;
  hasTranslated: boolean;
  layer: WorkspaceLayer;
  onLayerChange: (layer: WorkspaceLayer) => void;
  progress?: CleaningProgress;
  error?: CleaningHookError;
}
```

- [ ] **Step 1: Add failing workspace integration tests**

Update the mocks to expose the new controls and add these cases:

```tsx
test("first-run primary action prepares and translates without a second click", async () => {
  translatedImagesByPage.clear();
  cleaningResultsByPage.clear();
  await renderRestoredWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "เตรียมและแปลหน้านี้" }));
  await waitFor(() => expect(handleTranslate).toHaveBeenCalledOnce());
  expect(vi.mocked(useTranslation).mock.calls[0][0].preparePageForTranslation)
    .toEqual(expect.any(Function));
});

test("a preparation failure never reaches translation completion", async () => {
  handleTranslate.mockResolvedValueOnce(false);
  await renderRestoredWorkspace();
  fireEvent.click(screen.getByRole("button", { name: /เตรียมและแปล|แปลหน้านี้/ }));
  await waitFor(() => expect(handleTranslate).toHaveBeenCalledOnce());
  expect(toolbar()).not.toHaveAttribute("data-layer", "translated");
  expect(screen.getByRole("button", { name: /ลองใหม่|เตรียมและแปล/ })).toBeEnabled();
});

test("review enters translated mode without rerunning translation", async () => {
  await renderRestoredWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "ตรวจแก้คำแปล" }));
  expect(handleTranslate).not.toHaveBeenCalled();
  expect(toolbar()).toHaveAttribute("data-layer", "translated");
  expect(screen.getByRole("button", { name: "ส่งออก" })).toBeVisible();
});
```

Also assert that `เครื่องมือขั้นสูง` contains manual Clean/Mask/batch actions and that Export dispatches all five existing handlers.

- [ ] **Step 2: Prove integration tests fail**

Run:

```powershell
npm.cmd test -- tests/workflow/WorkspacePage.test.tsx tests/cleaning/CleaningToolbar.test.tsx tests/cleaning/CleaningToolbar.layers.test.tsx
```

Expected: FAIL because duplicate primary actions and the old toolbar contract still exist.

- [ ] **Step 3: Add review-entry state and derived CTA**

Use a page-URL set so changing pages does not mark another page reviewed:

```ts
const [reviewedPageUrls, setReviewedPageUrls] = useState<Set<string>>(
  () => new Set(),
);
const hasEnteredReview = Boolean(
  currentPageUrl && reviewedPageUrls.has(currentPageUrl),
);
const primaryAction = getWorkspacePrimaryAction({
  hasPage: Boolean(currentPageUrl),
  hasCleanResult: Boolean(currentCleaningResult),
  hasTranslation: hasCurrentTranslation,
  hasEnteredReview,
  isCleaning: Boolean(cleaningProgress) || workflowPhase === "cleaning",
  isTranslating,
  workflowPhase,
  cancellable: isTranslatingAll,
});
```

When manual Clean or Mask retry invalidates a translation, also delete that URL from `reviewedPageUrls`.

- [ ] **Step 4: Connect one action dispatcher**

Use the existing `handleTranslateCurrent`; its `preparePageForTranslation` callback already performs Clean before translation and throws on Clean failure, so no second Clean call is introduced.

```ts
const handlePrimaryAction = async () => {
  if (!currentPageUrl) return;
  if (primaryAction.kind === "prepare-and-translate" || primaryAction.kind === "translate") {
    const translated = await handleTranslateCurrent();
    if (translated) {
      setReviewedPageUrls((current) => {
        const next = new Set(current);
        next.delete(currentPageUrl);
        return next;
      });
    }
    return;
  }
  if (primaryAction.kind === "review") {
    setWorkspaceLayer("translated");
    setReviewedPageUrls((current) => new Set(current).add(currentPageUrl));
    return;
  }
  if (primaryAction.kind === "export") exportTriggerRef.current?.click();
};
```

- [ ] **Step 5: Replace duplicate header/mobile actions and slim `CleaningToolbar`**

Render `WorkspacePrimaryAction` once in each responsive header presentation, but keep a single semantic primary action visible at a time through the existing breakpoints. Replace the five inline export buttons with `WorkspaceExportMenu`. Move manual Clean, Mask edit, batch translate, and failed-page retry into `WorkspaceAdvancedTools`. Keep undo/redo and view/layer controls visually secondary. Remove Clean/Edit buttons from `CleaningToolbar`, leaving layers plus progress/error.

- [ ] **Step 6: Run focused regression tests and commit**

Run:

```powershell
npm.cmd test -- tests/workflow/WorkspacePage.test.tsx tests/workflow/WorkspaceControls.test.tsx tests/cleaning/CleaningToolbar.test.tsx tests/cleaning/CleaningToolbar.layers.test.tsx tests/translation/useTranslation.test.tsx tests/translation/useTranslation.mutualExclusion.test.tsx
```

Expected: PASS; the mutual-exclusion suite proves the consolidated CTA did not bypass operation locks.

```powershell
git add src/app/page.tsx components/cleaning/CleaningToolbar.tsx tests/workflow/WorkspacePage.test.tsx tests/cleaning/CleaningToolbar.test.tsx tests/cleaning/CleaningToolbar.layers.test.tsx
git commit -m "feat: consolidate workspace workflow actions"
```

---

### Task 5: Live, non-obscuring translated-bubble editor

**Files:**
- Modify: `lib/translationOverlay.ts`
- Modify: `tests/cleaning/translationOverlay.test.ts`

**Interfaces:**
- Consumes: each bubble's existing `b.t`, `renderBubble`, wrapper geometry, and `undoManager`.
- Produces DOM hooks used by tests and accessibility:
  - wrapper: `.translation-bubble`, `tabIndex=0`.
  - rendered canvas: `.tl-canvas`, always `opacity: 1`.
  - editor: `[data-translation-editor]` with a single-line input labelled `แก้ไขข้อความแปล`.
  - selected state: `data-selected="true"`.

- [ ] **Step 1: Add a reusable overlay fixture in the test file**

Extract the current image/container setup into `renderOverlay(text = "ข้อความแปล")`, returning `{ container, wrapper, canvas, toolbar }`. Keep fake timers and mocked canvas context from the existing suite.

- [ ] **Step 2: Add failing visibility and live-render tests**

```ts
test("keeps rendered text fully visible during hover and editing", async () => {
  const { wrapper, canvas, toolbar } = await renderOverlay();
  wrapper.dispatchEvent(new MouseEvent("mouseenter"));
  expect(canvas.style.opacity).toBe("1");
  toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
  expect(canvas.style.opacity).toBe("1");
  const editor = document.querySelector<HTMLElement>("[data-translation-editor]")!;
  expect(wrapper.contains(editor)).toBe(false);
});

test("renders every input on the real canvas and creates one undo transaction", async () => {
  const { toolbar } = await renderOverlay("เดิม");
  const drawText = vi.spyOn(CanvasRenderingContext2D.prototype, "fillText");
  toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
  const input = document.querySelector<HTMLInputElement>('[data-translation-editor] input')!;
  input.value = "ข้อความใหม่";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(drawText).toHaveBeenCalled();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(undoManager.undo()).toBe("แก้ไขข้อความ");
  expect(undoManager.undo()).toBeNull();
});
```
Add separate tests for Escape restoring the opening text, unchanged commit creating no undo record, and blur committing exactly once.

- [ ] **Step 3: Run and prove the tests fail against the opaque textarea**

Run: `npm.cmd test -- tests/cleaning/translationOverlay.test.ts`

Expected: FAIL because hover sets opacity to `0.15` and the current textarea lives inside the wrapper.

- [ ] **Step 4: Replace textarea editing with an anchored editor session**

Delete hover opacity mutation. Introduce one active editor per overlay container. At session open, capture `openingText`; append the editor to `tlContainer` rather than `wrapper`; position above using wrapper source geometry and flip below when the computed top is negative. Clamp horizontal placement to the container width. For `window.matchMedia("(max-width: 639px)")`, use a fixed bottom dock class.

On each `input`, assign `b.t = input.value` and call `renderBubble()`. On commit, trim once, render once, and push one undo action only when the final value differs from `openingText`. On Escape, restore `openingText`, render, remove the editor, and do not push. Guard commit with a boolean so Enter followed by blur cannot push twice.

- [ ] **Step 5: Run focused overlay and text-fitting regressions**

Run:

```powershell
npm.cmd test -- tests/cleaning/translationOverlay.test.ts tests/unit/ovalTextFitting.test.ts
```

Expected: PASS; the existing adaptive text fitting remains unchanged.

- [ ] **Step 6: Commit**

```powershell
git add lib/translationOverlay.ts tests/cleaning/translationOverlay.test.ts
git commit -m "feat: edit translated bubbles against live canvas"
```

---

### Task 6: Keyboard movement, resize, selection, and deletion

**Files:**
- Modify: `lib/translationOverlay.ts`
- Modify: `tests/cleaning/translationOverlay.test.ts`

**Interfaces:**
- Consumes: `currentBx/currentBy/currentBw/currentBh`, existing boundary/minimum-size rules, `renderBubble`, delete behavior, and `undoManager`.
- Produces: focusable wrapper keyboard contract from the spec.

- [ ] **Step 1: Add failing keyboard tests**

Test all modifiers and propagation:

```ts
test("moves and resizes a focused bubble in source-image pixels", async () => {
  const { wrapper } = await renderOverlay();
  const pageNavigation = vi.fn();
  window.addEventListener("keydown", pageNavigation);
  wrapper.focus();
  const leftBefore = Number.parseFloat(wrapper.style.left);
  wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(Number.parseFloat(wrapper.style.left)).toBe(leftBefore + 1);
  const topBefore = Number.parseFloat(wrapper.style.top);
  wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
  expect(Number.parseFloat(wrapper.style.top)).toBe(topBefore + 10);
  const widthBefore = Number.parseFloat(wrapper.style.width);
  wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
  expect(Number.parseFloat(wrapper.style.width)).toBe(widthBefore + 1);
  expect(pageNavigation).not.toHaveBeenCalled();
});
```

Add tests for Enter opening the editor, Escape clearing selection, Shift+Alt resize by ten, boundary clamping, minimum size, Delete/Backspace, and undo restoring deletion.

- [ ] **Step 2: Prove keyboard tests fail**

Run: `npm.cmd test -- tests/cleaning/translationOverlay.test.ts`

Expected: FAIL because wrappers are not keyboard-operable.

- [ ] **Step 3: Add focus and accessible selection semantics**

Set `tabIndex = 0`, class `translation-bubble`, and `aria-label = \`กล่องข้อความ: ${shortText}\`` where `shortText` is normalized whitespace and truncated to 60 characters. Focus and pointer selection set `data-selected="true"`; blur clears it only when focus is not moving into the attached editor/toolbar.

- [ ] **Step 4: Route keyboard changes through shared mutations**

Create local `moveBubble(dx, dy, label)` and `resizeBubble(dw, dh, label)` functions used by both pointer completion and keyboard handlers. Apply image-boundary and minimum-size constraints before rendering/persisting. Each handled key calls `preventDefault()` and `stopPropagation()`, renders once, persists adjustments, and pushes one undo record only when geometry changed.

Enter calls the same editor opener. Delete/Backspace calls the same undoable delete function as the toolbar. Escape cancels editing first; otherwise it clears selection and returns focus to the overlay container.

- [ ] **Step 5: Run overlay and workspace shortcut regressions**

Run:

```powershell
npm.cmd test -- tests/cleaning/translationOverlay.test.ts tests/workflow/WorkspacePage.test.tsx
```

Expected: PASS; bubble arrows do not reach global page navigation.

- [ ] **Step 6: Commit**

```powershell
git add lib/translationOverlay.ts tests/cleaning/translationOverlay.test.ts
git commit -m "feat: add keyboard bubble manipulation"
```

---

### Task 7: Mask Editor modal focus contract

**Files:**
- Modify: `components/cleaning/MaskEditor.tsx`
- Modify: `src/app/page.tsx`
- Modify: `tests/cleaning/MaskEditor.test.tsx`
- Modify: `tests/workflow/WorkspacePage.test.tsx`

**Interfaces:**
- `MaskEditorProps` adds `returnFocusRef?: React.RefObject<HTMLElement | null>`.
- Produces a titled dialog with focus trap, Escape dismissal, and return focus.

- [ ] **Step 1: Add failing modal tests**

```tsx
test("traps focus, closes on Escape, and restores the trigger", async () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  const returnFocusRef = { current: trigger };
  const onClose = vi.fn();
  renderMaskEditor({ onClose, returnFocusRef });
  const dialog = screen.getByRole("dialog", { name: "แก้ Mask" });
  expect(screen.getByRole("button", { name: "ปิดแก้ Mask" })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  expect(trigger).toHaveFocus();
});
```

Add Tab-from-last-to-first and Shift+Tab-from-first-to-last assertions.

- [ ] **Step 2: Prove the tests fail**

Run: `npm.cmd test -- tests/cleaning/MaskEditor.test.tsx`

Expected: FAIL because the current dialog uses only `aria-label` and has no focus lifecycle.

- [ ] **Step 3: Implement the modal contract**

Add `dialogRef`, `closeRef`, and a stable title id from `useId`. Focus `closeRef` on mount. Handle Escape and Tab on the dialog using the same focusable selector contract as Settings. Call a local `closeAndRestoreFocus` for close button, Escape, and successful submit; it invokes `onClose()` then queues `returnFocusRef.current?.focus()` in a microtask so the unmounted modal cannot reclaim focus.

Replace `aria-label` with `aria-labelledby={titleId}` and put the visible `แก้ Mask` heading at that id. Change the close accessible name to `ปิดแก้ Mask`.

- [ ] **Step 4: Connect the trigger ref in the workspace**

Create `maskEditorTriggerRef` in `page.tsx`, pass it through `WorkspaceAdvancedTools` to its Mask item trigger path, and pass it into `MaskEditor` as `returnFocusRef`. If the generic menu trigger owns focus before selection, retain the exact Mask action element ref so focus returns to the action the user invoked, not to an unrelated header control.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npm.cmd test -- tests/cleaning/MaskEditor.test.tsx tests/workflow/WorkspacePage.test.tsx
```

Expected: PASS.

```powershell
git add components/cleaning/MaskEditor.tsx src/app/page.tsx tests/cleaning/MaskEditor.test.tsx tests/workflow/WorkspacePage.test.tsx
git commit -m "fix: make mask dialog keyboard contained"
```

---

### Task 8: Keyboard brush cursor and accessible Mask controls

**Files:**
- Modify: `components/cleaning/MaskEditor.tsx`
- Modify: `tests/cleaning/MaskEditor.test.tsx`

**Interfaces:**
- Consumes: existing `applyBrush`, `renderMask`, `radius`, `mode`, and `undoManager`.
- Produces: `brushPoint: { x: number; y: number }`, focusable canvas instructions, visible keyboard cursor, and polite mode/radius status.

- [ ] **Step 1: Add deterministic canvas setup to tests**

Mock `Image` load, canvas `getContext`, `getImageData`, `putImageData`, and bounds so a 100-by-80 mask initializes predictably. Add a `renderMaskEditor` helper that accepts prop overrides.

- [ ] **Step 2: Add failing keyboard-canvas tests**

```tsx
test("moves the keyboard brush and applies one undoable mark", async () => {
  renderMaskEditor();
  const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
  canvas.focus();
  fireEvent.keyDown(canvas, { key: "ArrowRight" });
  fireEvent.keyDown(canvas, { key: "ArrowDown", shiftKey: true });
  fireEvent.keyDown(canvas, { key: " " });
  expect(applyBrush).toHaveBeenCalledWith(
    expect.any(ImageData),
    [{ x: 51, y: 50 }],
    8,
    "paint",
  );
  expect(undoManager.undo()).toBe("แก้ Mask");
});

test("brackets clamp radius and announce the new size", async () => {
  renderMaskEditor();
  const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
  fireEvent.keyDown(canvas, { key: "]" });
  expect(screen.getByRole("status")).toHaveTextContent("ขนาดแปรง 9 พิกเซล");
});
```

Also test Shift movement by ten, edge clamping, `Ctrl+z`/`Meta+z`, and that cursor movement alone does not announce continuously.

- [ ] **Step 3: Prove the tests fail**

Run: `npm.cmd test -- tests/cleaning/MaskEditor.test.tsx`

Expected: FAIL because the canvas has no keyboard role or handler.

- [ ] **Step 4: Implement one shared brush application path**

Extract `applyAtPoint(point)` for both pointer and keyboard use. Add `commitBrushAt(point)` that snapshots before/after and pushes one `แก้ Mask` undo record. Pointer strokes keep one record from pointerdown through pointerup; Space calls `commitBrushAt(brushPoint)` once.

Initialize `brushPoint` to the canvas center after image load. Set canvas `tabIndex={0}`, `role="application"`, `aria-label="พื้นที่แก้ Mask"`, and `aria-describedby={instructionsId}`. Render visible Thai instructions and an absolutely positioned, pointer-events-none circular cursor while the canvas is focused. Scale cursor position/radius from intrinsic canvas coordinates to rendered CSS bounds.

- [ ] **Step 5: Add key handling and status**

Arrows move/clamp by 1 or 10; Space paints; brackets clamp radius to the existing `2..48` range; Ctrl/Meta+Z prevents default and calls `undoManager.undo()`. Update a polite live region only for mode, radius, paint, and undo messages. Do not update it for cursor movement.

Increase touch-layout action targets to `min-h-11 min-w-11`, add focus-visible styles, and translate generic action labels to Thai while preserving engine names in the Cleaner select.

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npm.cmd test -- tests/cleaning/MaskEditor.test.tsx tests/cleaning/maskEdits.test.ts
```

Expected: PASS.

```powershell
git add components/cleaning/MaskEditor.tsx tests/cleaning/MaskEditor.test.tsx
git commit -m "feat: add keyboard mask painting"
```

---

### Task 9: Responsive, failure-state, and full regression verification

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

- [ ] **Step 1: Add failing responsive and failure-state tests**

Test semantic behavior rather than Tailwind implementation details:

- At one breakpoint presentation, exactly one enabled primary workflow button is accessible.
- Advanced/export triggers expose `aria-expanded` and do not disappear when the viewport width is 375 pixels.
- A cleaning error is rendered with `role="alert"` and a retry-capable primary action.
- Batch partial failure keeps the `ส่งออก` action for successful current pages and exposes `ลองใหม่ N หน้าที่พลาด` in advanced tools.
- Mobile editing dock and thumbnail region do not share the same fixed bottom offset class.

- [ ] **Step 2: Run focused tests and prove the remaining gaps**

Run:

```powershell
npm.cmd test -- tests/workflow/WorkspacePage.test.tsx tests/workflow/WorkspaceControls.test.tsx
```

Expected: at least one new assertion fails before responsive/failure polish.

- [ ] **Step 3: Finish responsive and error-state behavior**

Keep the CTA label untruncated; move advanced controls into the menu before compressing it. Clamp menus with `max-h-[min(70vh,24rem)] overflow-y-auto`. Ensure mobile uses one primary CTA and that the overlay editing dock reserves space above the visible thumbnail strip. Add `role="alert"` only to terminal errors, while ongoing progress remains `role="status"`/`aria-live="polite"`. Remove pulsing failure animation and use a static high-contrast indicator.

- [ ] **Step 4: Run the complete test suite**

Run: `npm.cmd test`

Expected: all Vitest suites PASS with no unhandled rejection.

- [ ] **Step 5: Run lint and type-check**

Run:

```powershell
npm.cmd run lint
npx.cmd tsc --noEmit
```

Expected: both commands exit 0. Fix only errors introduced by this plan; report unrelated pre-existing warnings without suppressing them.

- [ ] **Step 6: Run the production build**

Run: `npm.cmd run build`

Expected: Next.js production compilation, type validation, and route generation complete successfully with exit code 0.

- [ ] **Step 7: Inspect the final diff and commit**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only intended source/test/doc files are present. Do not stage `.impeccable/` or unrelated pre-existing changes.

```powershell
git add src/app/page.tsx components/workspace/WorkspacePrimaryAction.tsx components/workspace/WorkspaceMenu.tsx components/workspace/WorkspaceAdvancedTools.tsx components/workspace/WorkspaceExportMenu.tsx tests/workflow/WorkspacePage.test.tsx tests/workflow/WorkspaceControls.test.tsx
git commit -m "fix: complete workspace UI accessibility pass"
```

## Completion Evidence

The implementation handoff must report:

- The final Vitest test count and exit code.
- Lint exit code and any pre-existing warnings.
- TypeScript `--noEmit` exit code.
- Next.js production build exit code.
- A short manual verification note for desktop, tablet, and mobile viewport behavior.
- Any spec acceptance criterion not completed; do not describe the work as complete while one remains.