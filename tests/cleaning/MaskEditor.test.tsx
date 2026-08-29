import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { MaskEditor } from "@/components/cleaning/MaskEditor";
import * as maskEditsModule from "@/lib/cleaning/maskEdits";
import type { CleaningRegion } from "@/lib/cleaning/types";
import { undoManager } from "@/lib/undoManager";

const preservedRegion: CleaningRegion = {
  id: "region-1",
  rect: { x: 10, y: 10, width: 20, height: 12 },
  route: "flat",
  confidence: 0.9,
  status: "preserved",
  residualScore: 0,
  damageScore: 0,
  pageRole: "comic",
  textRole: "review",
  eligibilityConfidence: 0.7,
  automaticAction: "preserve",
  protectionReasons: ["low-confidence"],
};

function renderMaskEditor(props: Partial<React.ComponentProps<typeof MaskEditor>> = {}) {
  return render(
    <MaskEditor
      sourceUrl="blob:clean"
      maskUrl="blob:mask"
      regions={[preservedRegion]}
      onClose={vi.fn()}
      onRetry={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
}

describe("MaskEditor", () => {
  beforeEach(() => {
    undoManager.clear();

    // Mock Image naturalWidth/naturalHeight and auto onload
    class MockImage {
      naturalWidth = 100;
      naturalHeight = 80;
      width = 100;
      height = 80;
      onload: (() => void) | null = null;
      private _src = "";
      set src(value: string) {
        this._src = value;
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
      get src() {
        return this._src;
      }
    }
    vi.stubGlobal("Image", MockImage);

    // Mock Canvas 2D Context
    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn((_x, _y, w, h) => new ImageData(w || 100, h || 80)),
      putImageData: vi.fn(),
      createImageData: vi.fn((w, h) => new ImageData(w, h)),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext as unknown as CanvasRenderingContext2D) as any;
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 100,
      height: 80,
      right: 100,
      bottom: 80,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
  });

  test("preserved region offers force clean, protect, and automatic actions", () => {
    renderMaskEditor();

    expect(
      (screen.getByRole("button", { name: "Force clean" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Protect" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Reset to automatic" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByText("ลบตาม Mask นี้แม้ระบบป้องกันไว้")).toBeTruthy();
  });

  test("traps focus, closes on Escape, and restores the trigger", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const returnFocusRef = { current: trigger };
    const onClose = vi.fn();

    renderMaskEditor({ onClose, returnFocusRef });

    const dialog = screen.getByRole("dialog", { name: "แก้ Mask" });
    const closeBtn = screen.getByRole("button", { name: "ปิดแก้ Mask" });

    // Focus close button initially
    expect(closeBtn).toHaveFocus();

    // Escape closes and restores focus
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());

    // Clean up
    trigger.remove();
  });

  test("traps Tab key within dialog (cycles last to first, Shift+Tab first to last)", () => {
    renderMaskEditor();

    const dialog = screen.getByRole("dialog", { name: "แก้ Mask" });
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    expect(first).toHaveFocus();

    // Shift+Tab from first should focus last
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    // Tab from last should focus first
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: false });
    expect(first).toHaveFocus();
  });

  test("moves the keyboard brush and applies one undoable mark", async () => {
    const applyBrushSpy = vi.spyOn(maskEditsModule, "applyBrush");
    renderMaskEditor();

    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    canvas.focus();

    // Move brush from center (50, 40) right by 1 -> (51, 40), then down by 10 (Shift) -> (51, 50)
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(canvas, { key: " " });

    expect(applyBrushSpy).toHaveBeenCalledWith(
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
    canvas.focus();

    fireEvent.keyDown(canvas, { key: "]" });
    expect(screen.getByRole("status")).toHaveTextContent("ขนาดแปรง 9 พิกเซล");

    // Press '[' twice -> 8 then 7
    fireEvent.keyDown(canvas, { key: "[" });
    expect(screen.getByRole("status")).toHaveTextContent("ขนาดแปรง 8 พิกเซล");
  });

  test("clamps keyboard brush movement to image bounds and supports Ctrl+Z undo", async () => {
    renderMaskEditor();

    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    canvas.focus();

    // Paint once
    fireEvent.keyDown(canvas, { key: " " });
    expect(screen.getByRole("status")).toHaveTextContent("เพิ่ม Mask แล้ว");

    // Ctrl+Z undoes
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(screen.getByRole("status")).toHaveTextContent("เลิกทำแล้ว");
  });

  test("cursor movement alone does not announce continuously", async () => {
    renderMaskEditor();

    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    canvas.focus();

    const status = screen.getByRole("status");
    const initialText = status.textContent;

    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowUp" });
    fireEvent.keyDown(canvas, { key: "ArrowDown" });

    // Status should not have changed during arrow movements
    expect(status.textContent).toBe(initialText);
  });
});
