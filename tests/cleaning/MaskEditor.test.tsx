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
let mockMaskHasPixels = true;
let mockMaskPixels: Array<[number, number]> = [[11, 11], [12, 11], [11, 12], [12, 12]];

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
    mockMaskHasPixels = true;
    mockMaskPixels = [[11, 11], [12, 11], [11, 12], [12, 12]];

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
      getImageData: vi.fn((_x, _y, w, h) => {
        const width = w || 100;
        const height = h || 80;
        const data = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
        if (mockMaskHasPixels) {
          for (const [x, y] of mockMaskPixels) {
            const index = (y * data.width + x) * 4;
            data.data[index] = 255;
            data.data[index + 3] = 255;
          }
        }
        return data;
      }),
      putImageData: vi.fn(),
      createImageData: vi.fn((w, h) => new ImageData(new Uint8ClampedArray(w * h * 4), w, h)),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => mockContext as unknown as CanvasRenderingContext2D,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
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
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  });

  test("preserved region offers force clean, protect, and automatic actions", () => {
    renderMaskEditor();

    expect(
      (screen.getByRole("button", { name: "อนุมัติ Mask และลบ" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Protect" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "ยืนยันว่าเป็นข้อความ" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByText("ยืนยันข้อความก่อน แล้วตรวจพื้นที่สีแดงที่จะลบเฉพาะบริเวณที่เลือก")).toBeTruthy();
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

  test("moves the keyboard brush but space never paints", async () => {
    const applyBrushSpy = vi.spyOn(maskEditsModule, "applyBrush");
    renderMaskEditor();

    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    canvas.focus();

    // Move brush from center (50, 40) right by 1 -> (51, 40), then down by 10 (Shift) -> (51, 50)
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowDown", shiftKey: true });

    // Space is reserved for panning: it must not stamp mask pixels.
    fireEvent.keyDown(canvas, { key: " " });

    expect(applyBrushSpy).not.toHaveBeenCalled();
    expect(undoManager.canUndo()).toBe(false);
  });

  test("space sets pan mode so dragging pans instead of painting", async () => {
    const applyBrushSpy = vi.spyOn(maskEditsModule, "applyBrush");
    renderMaskEditor();

    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    canvas.focus();

    fireEvent.keyDown(canvas, { key: " " });
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 25 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.keyUp(canvas, { key: " " });

    expect(applyBrushSpy).not.toHaveBeenCalled();
    const panWrapper = document.querySelector<HTMLElement>(
      ".transition-transform.duration-75",
    );
    expect(panWrapper?.getAttribute("style")).toContain("translate(30px, 15px)");
  });

  test("mouse painting keeps working and supports Ctrl+Z undo", async () => {
    const applyBrushSpy = vi.spyOn(maskEditsModule, "applyBrush");
    renderMaskEditor();

    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    canvas.focus();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 30, clientY: 40, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(applyBrushSpy).toHaveBeenCalled();

    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(screen.getByRole("status")).toHaveTextContent("เลิกทำแล้ว");
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

  test("space never announces painting or pushes undo entries", async () => {
    renderMaskEditor();

    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    canvas.focus();

    fireEvent.keyDown(canvas, { key: " " });
    expect(screen.getByRole("status")).not.toHaveTextContent("เพิ่ม Mask แล้ว");

    // Ctrl+Z has nothing to undo because space never painted.
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(screen.getByRole("status")).not.toHaveTextContent("เลิกทำแล้ว");
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

  test("One-Click Clean automatically chains confirm-text and force-clean for unconfirmed regions", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(["mock-mask"], { type: "image/png" }));
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;

    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onClose });

    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });

    const oneClickCleanBtn = screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ });
    expect(oneClickCleanBtn).toBeTruthy();

    fireEvent.click(oneClickCleanBtn);

    await waitFor(() => {
      // First call confirms text because textConfirmed was false
      expect(onRetry).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "confirm-text");
      // Second call executes force-clean
      expect(onRetry).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "force-clean");
      // Closes dialog after completion
      expect(onClose).toHaveBeenCalled();
    });
    const context = HTMLCanvasElement.prototype.getContext.call(document.createElement("canvas"), "2d") as CanvasRenderingContext2D;
    const grayscale = vi.mocked(context.putImageData).mock.calls.at(-1)?.[0];
    expect(grayscale).toBeDefined();
    const authorized = Array.from({ length: grayscale!.width * grayscale!.height }, (_, i) => grayscale!.data[i * 4])
      .filter((value) => value === 255);
    expect(authorized).toHaveLength(4);
  });

  test("One-Click Clean stays open and stops when text confirmation fails", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(["mock-mask"], { type: "image/png" }));
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;

    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onClose });

    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.click(screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "ยืนยันข้อความไม่สำเร็จ กรุณาลองใหม่",
      );
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalledWith(
      "region-1",
      expect.any(Blob),
      "auto",
      "force-clean",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  test("One-Click Clean stays open when force-clean returns no result", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(["mock-mask"], { type: "image/png" }));
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;

    const onRetry = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onClose });

    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.click(screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "คลีนตาม Mask ไม่สำเร็จ กรุณาลองใหม่",
      );
    });
    expect(onRetry).toHaveBeenNthCalledWith(
      1,
      "region-1",
      expect.any(Blob),
      "auto",
      "confirm-text",
    );
    expect(onRetry).toHaveBeenNthCalledWith(
      2,
      "region-1",
      expect.any(Blob),
      "auto",
      "force-clean",
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(3));
    expect(onRetry.mock.calls.map((call) => call[3])).toEqual(["confirm-text", "force-clean", "force-clean"]);
  });

  test("Clean Now makes one proposal refresh and keeps the editor open when no pixels exist", async () => {
    mockMaskHasPixels = false;
    const onRetry = vi.fn();
    const onClose = vi.fn();
    const onRefreshProposal = vi.fn().mockResolvedValue({ region: preservedRegion, maskUrl: "blob:refreshed" });
    renderMaskEditor({ onRetry, onClose, onRefreshProposal });

    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.click(screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("กรุณาวาด Mask หรือกดเติมเต็มกรอบเอง"));
    expect(onRefreshProposal).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("strong three-pixel remap intersects old edits before material-overflow validation", async () => {
    mockMaskPixels = [[10, 11], [14, 11]];
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(["mask"], { type: "image/png" }))) as typeof HTMLCanvasElement.prototype.toBlob;
    const recovered = { ...preservedRegion, id: "region-new", rect: { ...preservedRegion.rect, x: 13 } };
    const onResolveRegion = vi.fn().mockResolvedValue({ region: recovered, proposalMaskUrl: "blob:proposal", remapped: true });
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    renderMaskEditor({ onResolveRegion, onRetry, onClose });
    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.click(screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    expect(onRetry.mock.calls.map((call) => call[0])).toEqual(["region-new", "region-new"]);
    expect(screen.getByRole("status")).toHaveTextContent("จับคู่พื้นที่ใหม่");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("proposal refresh retains an earlier remap notice", async () => {
    mockMaskHasPixels = false;
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(["mask"], { type: "image/png" }))) as typeof HTMLCanvasElement.prototype.toBlob;
    const recovered = { ...preservedRegion, id: "region-new" };
    const onResolveRegion = vi.fn().mockResolvedValue({ region: recovered, proposalMaskUrl: "blob:empty", remapped: true });
    const onRefreshProposal = vi.fn().mockImplementation(async () => {
      mockMaskHasPixels = true;
      return { region: preservedRegion, maskUrl: "blob:refreshed" };
    });
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    renderMaskEditor({ onResolveRegion, onRefreshProposal, onRetry, onClose });
    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.click(screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    expect(onRefreshProposal).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ปรับ Mask"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("small brush overflow is clipped and reported after Clean Now", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(["mask"], { type: "image/png" }))) as typeof HTMLCanvasElement.prototype.toBlob;
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onClose });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    fireEvent.pointerDown(canvas, { clientX: 11, clientY: 11, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("ปรับ Mask");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("material brush overflow stops without closing or confirming", async () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onClose });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 11, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /คลีนจุดนี้ทันที/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Mask เกินพื้นที่"));
    expect(onRetry).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("granular mask actions stay open when retry returns no result", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(["mock-mask"], { type: "image/png" }));
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;

    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onClose });

    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.click(screen.getByRole("button", { name: "Protect" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "บันทึก Mask ไม่สำเร็จ กรุณาลองใหม่",
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Region stepper and overlay badges switch between speech bubbles", async () => {
    const secondRegion: CleaningRegion = {
      id: "region-2",
      rect: { x: 50, y: 40, width: 30, height: 20 },
      route: "artwork",
      confidence: 0.95,
      status: "needs_review",
      residualScore: 0,
      damageScore: 0,
      pageRole: "comic",
      textRole: "review",
      eligibilityConfidence: 0.8,
      automaticAction: "clean",
      protectionReasons: [],
    };

    renderMaskEditor({ regions: [preservedRegion, secondRegion] });

    // Initial region is #1
    expect(screen.getByText("1 / 2")).toBeTruthy();

    // Click Next Balloon button
    const nextBtn = screen.getByRole("button", { name: "บอลลูนถัดไป" });
    fireEvent.click(nextBtn);
    expect(screen.getByText("2 / 2")).toBeTruthy();

    // Click badge for #1 directly on the canvas overlay
    const badge1 = await screen.findByRole("button", { name: "เลือกบอลลูนที่ 1: region-1" });
    fireEvent.click(badge1);
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  test("Smart Fill Box and Clear Box modify the mask and support Undo", async () => {
    renderMaskEditor();

    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });

    const fillBtn = screen.getByRole("button", { name: "เติมเต็มกรอบ" });
    fireEvent.click(fillBtn);
    expect(screen.getByRole("status")).toHaveTextContent("เติม Mask เต็มกรอบแล้ว");

    // Undo fill
    expect(undoManager.undo()).toBe("เติม Mask เต็มกรอบ");

    const clearBtn = screen.getByRole("button", { name: "ล้างกรอบนี้" });
    fireEvent.click(clearBtn);
    expect(screen.getByRole("status")).toHaveTextContent("ล้าง Mask ในกรอบแล้ว");

    // Undo clear
    expect(undoManager.undo()).toBe("ล้าง Mask ในกรอบ");
  });

  test("Zoom controls allow zooming in, out, and resetting zoom", () => {
    renderMaskEditor();

    const zoomInBtn = screen.getByRole("button", { name: "ซูมเข้า" });
    const zoomOutBtn = screen.getByRole("button", { name: "ซูมออก" });
    const resetBtn = screen.getByRole("button", { name: "พอดีหน้าจอ" });

    // Initial zoom is 100%
    expect(screen.getByText("100%")).toBeTruthy();

    // Zoom in to 125%
    fireEvent.click(zoomInBtn);
    expect(screen.getByText("125%")).toBeTruthy();

    // Zoom in to 150%
    fireEvent.click(zoomInBtn);
    expect(screen.getByText("150%")).toBeTruthy();

    // Zoom out to 125%
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText("125%")).toBeTruthy();

    // Reset zoom
    fireEvent.click(resetBtn);
    expect(screen.getByText("100%")).toBeTruthy();
  });
});
