import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
let mockMaskPixelsByUrl: Map<string, boolean> | undefined;
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
    mockMaskPixelsByUrl = undefined;
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
    let drawnMaskUrl = "";
    const mockContext = {
      drawImage: vi.fn((image: HTMLImageElement) => { drawnMaskUrl = image.src; }),
      getImageData: vi.fn((_x, _y, w, h) => {
        const width = w || 100;
        const height = h || 80;
        const data = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
        if (mockMaskPixelsByUrl?.get(drawnMaskUrl) ?? mockMaskHasPixels) {
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

  test("shows the applied mask for an already-cleaned review region even when its proposal is empty", async () => {
    mockMaskPixelsByUrl = new Map([["blob:mask", true], ["blob:proposal", false]]);
    renderMaskEditor({ proposalMaskUrl: "blob:proposal", regions: [{ ...preservedRegion, status: "needs_review", automaticAction: "clean" }] });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    await waitFor(() => {
      const display = vi.mocked(context.putImageData).mock.calls.at(-1)?.[0];
      expect(display?.data[(11 * 100 + 11) * 4 + 3]).toBe(150);
    });
    expect(vi.mocked(context.drawImage).mock.calls[0][0]).toHaveProperty("src", "blob:mask");
  });

  test.each([
    [true, preservedRegion.rect],
    [false, { x: 95, y: -2, width: 12, height: 6 }],
  ])("whole region restore encodes the entire clipped rectangle without strokes (%s)", async (hasPixels, rect) => {
    mockMaskHasPixels = hasPixels;
    let encoded: ImageData | undefined;
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (this: HTMLCanvasElement, callback: BlobCallback) {
      const context = this.getContext("2d")!;
      encoded = vi.mocked(context.putImageData).mock.calls.at(-1)?.[0];
      callback(new Blob(["mask"], { type: "image/png" }));
    }) as typeof HTMLCanvasElement.prototype.toBlob;
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    renderMaskEditor({ onRetry, regions: [{ ...preservedRegion, rect }] });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "กู้ภาพเดิมทั้งจุด" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(onRetry).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "protect");
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 100; x++) {
        const expected = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height ? 255 : 0;
        expect(Array.from(encoded!.data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4))).toEqual([expected, expected, expected, 255]);
      }
    }
  });

  test("whole region pending blocks navigation, duplicate requests and draft mutations", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn(callback => callback(new Blob(["mask"]))) as typeof HTMLCanvasElement.prototype.toBlob;
    let finish!: (value: unknown) => void;
    const onRetry = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const second = { ...preservedRegion, id: "region-2" };
    renderMaskEditor({ onRetry, regions: [preservedRegion, second] });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    fireEvent.pointerDown(canvas, { clientX: 15, clientY: 15, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    fireEvent.click(screen.getByRole("button", { name: "กู้ภาพเดิมทั้งจุด" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce());
    const calls = vi.mocked(context.putImageData).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "กู้ภาพเดิมทั้งจุด" }));
    expect(screen.getByRole("button", { name: "จุดถัดไป" })).toBeDisabled();
    expect(screen.getByLabelText("จุดที่แก้ไข")).toBeDisabled();
    expect(screen.getByRole("button", { name: "เลือกจุดที่ 2" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo Mask" })).toBeDisabled();
    fireEvent.click(screen.getByText("ตัวเลือกเพิ่มเติม"));
    expect(screen.getByRole("button", { name: "เติมเต็มกรอบ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ล้างกรอบนี้" })).toBeDisabled();
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 2, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    expect(context.putImageData).toHaveBeenCalledTimes(calls);
    expect(onRetry).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: true }));
  });

  test.each([undefined, new Error("restore failed")])("whole region failure retains the draft and allows retry (%s)", async failure => {
    HTMLCanvasElement.prototype.toBlob = vi.fn(callback => callback(new Blob(["mask"]))) as typeof HTMLCanvasElement.prototype.toBlob;
    const onRetry = vi.fn().mockImplementationOnce(() => failure instanceof Error ? Promise.reject(failure) : Promise.resolve(failure)).mockResolvedValue({ ok: true });
    renderMaskEditor({ onRetry });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    fireEvent.pointerDown(canvas, { clientX: 15, clientY: 15, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    const draft = vi.mocked(context.putImageData).mock.calls.at(-1)![0];
    const button = screen.getByRole("button", { name: "กู้ภาพเดิมทั้งจุด" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent(failure instanceof Error ? "restore failed" : "กู้ภาพเดิมไม่สำเร็จ");
    // A subsequent draft edit must start from the retained image, not the encoded grayscale mask.
    fireEvent.pointerDown(canvas, { clientX: 35, clientY: 35, pointerId: 2, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    const retained = vi.mocked(context.putImageData).mock.calls.at(-1)![0];
    expect(retained.data[(15 * 100 + 15) * 4 + 3]).toBe(draft.data[(15 * 100 + 15) * 4 + 3]);
    fireEvent.click(button);
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
  });

  test("whole region success clears drafts across navigation and invalidates old brush undo without clearing other history", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn(callback => callback(new Blob(["mask"]))) as typeof HTMLCanvasElement.prototype.toBlob;
    const otherUndo = vi.fn();
    undoManager.push({ label: "other edit", undo: otherUndo, redo: vi.fn() });
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    renderMaskEditor({ onRetry, cleanUrl: "blob:cleaned", regions: [preservedRegion, { ...preservedRegion, id: "region-2" }] });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    fireEvent.pointerDown(canvas, { clientX: 15, clientY: 15, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByText("ตัวเลือกเพิ่มเติม"));
    fireEvent.click(screen.getByRole("button", { name: "เติมเต็มกรอบ" }));
    fireEvent.click(screen.getByRole("button", { name: "ล้างกรอบนี้" }));
    fireEvent.click(screen.getByRole("button", { name: "ภาพเดิม" }));
    fireEvent.click(screen.getByRole("button", { name: "กู้ภาพเดิมทั้งจุด" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("กู้ภาพเดิมทั้งจุดแล้ว"));
    expect(screen.getByRole("img", { name: "ภาพที่คลีนแล้ว" })).toHaveAttribute("src", "blob:cleaned");
    const assertEmpty = () => expect(vi.mocked(context.putImageData).mock.calls.at(-1)![0].data[(11 * 100 + 11) * 4 + 3]).toBe(0);
    assertEmpty();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "จุดถัดไป" })); await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "จุดก่อนหน้า" })); await new Promise(resolve => setTimeout(resolve, 0)); });
    assertEmpty();
    undoManager.undo();
    undoManager.undo();
    undoManager.undo();
    assertEmpty();
    undoManager.undo();
    expect(otherUndo).toHaveBeenCalledOnce();
    undoManager.redo();
    undoManager.redo();
    undoManager.redo();
    undoManager.redo();
    assertEmpty();
  });

  test("whole region recovery keeps the returned region selected and announces remapping", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn(callback => callback(new Blob(["mask"]))) as typeof HTMLCanvasElement.prototype.toBlob;
    const recovered = { ...preservedRegion, id: "region-new", rect: { ...preservedRegion.rect, x: 13 } };
    const onRetry = vi.fn().mockResolvedValue({ recoveredRegionId: recovered.id, regions: [recovered] });
    const { rerender } = renderMaskEditor({ onRetry });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    fireEvent.click(screen.getByRole("button", { name: "กู้ภาพเดิมทั้งจุด" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("จับคู่พื้นที่ใหม่"));
    rerender(<MaskEditor sourceUrl="blob:clean" maskUrl="blob:updated-mask" regions={[recovered]} onClose={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByLabelText("จุดที่แก้ไข")).toHaveValue("region-new");
    const display = vi.mocked((canvas as HTMLCanvasElement).getContext("2d")!.putImageData).mock.calls.at(-1)![0];
    expect(display.data[(11 * 100 + 14) * 4 + 3]).toBe(0);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test("shows the proposal for a preserved review region only when its applied mask is empty", async () => {
    mockMaskPixelsByUrl = new Map([["blob:mask", false], ["blob:proposal", true]]);
    renderMaskEditor({ proposalMaskUrl: "blob:proposal" });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    await waitFor(() => {
      const display = vi.mocked(context.putImageData).mock.calls.at(-1)?.[0];
      expect(display?.data[(11 * 100 + 11) * 4 + 3]).toBe(150);
    });
    expect(context.drawImage).toHaveBeenCalledTimes(2);
  });

  test("primary tools and comparison describe removal and source recovery", () => {
    renderMaskEditor({ cleanUrl: "blob:cleaned" });
    expect(screen.getByRole("button", { name: "ลบข้อความ" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "กู้เฉพาะส่วน" })).toBeVisible();
    expect(screen.getByRole("button", { name: "ไม่ลบตรงนี้" })).toBeVisible();
    expect(screen.getByText("สีแดง = พื้นที่ที่จะลบ")).toBeVisible();
    expect(screen.getByText("ตัวเลือกเพิ่มเติม").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("img", { name: "ภาพที่คลีนแล้ว" })).toHaveAttribute("src", "blob:cleaned");
    fireEvent.click(screen.getByRole("button", { name: "ภาพเดิม" }));
    expect(screen.getByRole("img", { name: "ภาพเดิม" })).toHaveAttribute("src", "blob:clean");
  });

  test("restore applies protection without force-clean and keeps the editor open", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(["mask"], { type: "image/png" }))) as typeof HTMLCanvasElement.prototype.toBlob;
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onClose });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    fireEvent.click(screen.getByRole("button", { name: "กู้เฉพาะส่วน" }));
    fireEvent.pointerDown(canvas, { clientX: 15, clientY: 15, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "ใช้กับจุดนี้" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "protect"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("fits and centers the next selected region", async () => {
    const second = { ...preservedRegion, id: "region-2", rect: { x: 65, y: 50, width: 20, height: 12 } };
    const { container } = renderMaskEditor({ regions: [preservedRegion, second] });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    const image = container.querySelector("img")!;
    const workspace = image.closest(".min-h-0")!;
    Object.defineProperties(image, { clientWidth: { value: 100 }, clientHeight: { value: 80 } });
    Object.defineProperties(workspace, { clientWidth: { value: 500 }, clientHeight: { value: 400 } });
    fireEvent.load(image);
    const wrapper = container.querySelector<HTMLElement>(".transition-transform.duration-75")!;
    expect(wrapper.style.transform).toContain("translate(30px, 24px)");
    fireEvent.click(screen.getByRole("button", { name: "จุดถัดไป" }));
    await waitFor(() => expect(wrapper.style.transform).toContain("translate(-25px, -15.999999999999996px)"));
  });

  test("restoring then undoing leaves no protection selection to submit", async () => {
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    renderMaskEditor({ onRetry });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    fireEvent.click(screen.getByRole("button", { name: "กู้เฉพาะส่วน" }));
    fireEvent.pointerDown(canvas, { clientX: 15, clientY: 15, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Undo Mask" }));
    fireEvent.click(screen.getByRole("button", { name: "ใช้กับจุดนี้" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ระบายจุดที่ต้องการกู้ภาพเดิมก่อน"));
    expect(onRetry).not.toHaveBeenCalled();
  });

  test("excluding the entire removal mask restores only those source pixels without proposal recovery", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn(callback => callback(new Blob(["mask"], { type: "image/png" }))) as typeof HTMLCanvasElement.prototype.toBlob;
    const onRefreshProposal = vi.fn();
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onRefreshProposal, onClose });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    fireEvent.click(screen.getByRole("button", { name: "ไม่ลบตรงนี้" }));
    fireEvent.pointerDown(canvas, { clientX: 15, clientY: 15, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "ใช้กับจุดนี้" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "protect"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRefreshProposal).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    const encoded = vi.mocked(context.putImageData).mock.calls.at(-1)![0];
    expect(Array.from(encoded.data).filter((_, index) => index % 4 === 0).filter(value => value === 255)).toHaveLength(4);
  });

  test("excluding some glyphs keeps remaining mask eligible for cleaning", async () => {
    mockMaskPixels = [[11, 11], [25, 11]];
    HTMLCanvasElement.prototype.toBlob = vi.fn(callback => callback(new Blob(["mask"], { type: "image/png" }))) as typeof HTMLCanvasElement.prototype.toBlob;
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    renderMaskEditor({ onRetry });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "ไม่ลบตรงนี้" }));
    fireEvent.pointerDown(canvas, { clientX: 11, clientY: 11, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "ใช้กับจุดนี้" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "force-clean"));
    expect(onRetry).not.toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "protect");
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    const encoded = vi.mocked(context.putImageData).mock.calls.at(-1)![0];
    expect(Array.from(encoded.data).filter((_, index) => index % 4 === 0).filter(value => value === 255)).toHaveLength(1);
  });

  test("proposal recovery submits positive removal pixels after loading a grayscale mask", async () => {
    mockMaskHasPixels = false;
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(["mask"], { type: "image/png" }))) as typeof HTMLCanvasElement.prototype.toBlob;
    const onRefreshProposal = vi.fn().mockImplementation(async () => {
      mockMaskHasPixels = true;
      return { region: preservedRegion, maskUrl: "blob:proposal" };
    });
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    renderMaskEditor({ onRetry, onRefreshProposal });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "100"));
    const context = (canvas as HTMLCanvasElement).getContext("2d")!;
    const originalRead = vi.mocked(context.getImageData).getMockImplementation()!;
    vi.mocked(context.getImageData).mockImplementation((...args) => {
      const data = originalRead(...args);
      for (let i = 0; i < data.data.length; i += 4) { if (data.data[i]) { data.data[i + 1] = 255; data.data[i + 2] = 255; } }
      return data;
    });
    fireEvent.click(screen.getByRole("button", { name: "ใช้กับจุดนี้" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    const encoded = vi.mocked(context.putImageData).mock.calls.at(-1)![0];
    expect(Array.from(encoded.data).filter((_, index) => index % 4 === 0).filter(value => value === 255)).toHaveLength(4);
  });

  test("preserved region offers force clean, protect, and automatic actions", () => {
    renderMaskEditor();
    fireEvent.click(screen.getByText("ตัวเลือกเพิ่มเติม"));

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
    const candidates = dialog.querySelectorAll<HTMLElement>(
      'summary, button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const focusable = Array.from(candidates).filter(element => !element.closest("details") || element.tagName === "SUMMARY");
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

  test("keeps mask undo memory bounded with operation replay", async () => {
    const imageSpy = vi.spyOn(globalThis, "ImageData");
    const applyBrushSpy = vi.spyOn(maskEditsModule, "applyBrush");
    renderMaskEditor();

    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    canvas.focus();

    const strokes = [[30, 40], [60, 40], [45, 60], [70, 20], [20, 70]];
    for (const [x, y] of strokes) {
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: x, clientY: y, button: 0 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    }

    // Undo history must not allocate full-page clones per stroke (before: 3
    // clones per stroke entered the undo stack). Remaining full-page
    // allocations are the base snapshot plus transient applyBrush outputs.
    const fullPageAllocations = imageSpy.mock.calls.filter(
      (call) => call[1] === 100 && call[2] === 80,
    ).length;
    expect(fullPageAllocations).toBeLessThanOrEqual(8);

    // Undo replays the four earlier stroke ops from the base snapshot.
    const replayCallsBefore = applyBrushSpy.mock.calls.length;
    undoManager.undo();
    const replayCallsAfter = applyBrushSpy.mock.calls.length - replayCallsBefore;
    expect(replayCallsAfter).toBe(strokes.length - 1);
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

    const oneClickCleanBtn = screen.getByRole("button", { name: /ใช้กับจุดนี้/ });
    expect(oneClickCleanBtn).toBeTruthy();

    fireEvent.click(oneClickCleanBtn);

    await waitFor(() => {
      // First call confirms text because textConfirmed was false
      expect(onRetry).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "confirm-text");
      // Second call executes force-clean
      expect(onRetry).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "force-clean");
      // Applying keeps the editor open for the next correction
      expect(onClose).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("button", { name: /ใช้กับจุดนี้/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /ใช้กับจุดนี้/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /ใช้กับจุดนี้/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /ใช้กับจุดนี้/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /ใช้กับจุดนี้/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /ใช้กับจุดนี้/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /ใช้กับจุดนี้/ }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("ปรับ Mask");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("material brush overflow is clipped and still cleans inside the region", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(["mask"], { type: "image/png" }))) as typeof HTMLCanvasElement.prototype.toBlob;
    const onRetry = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    renderMaskEditor({ onRetry, onClose });
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 11, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /ใช้กับจุดนี้/ }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("ปรับ Mask");
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
    fireEvent.click(screen.getByText("ตัวเลือกเพิ่มเติม"));
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
    const nextBtn = screen.getByRole("button", { name: "จุดถัดไป" });
    fireEvent.click(nextBtn);
    expect(screen.getByText("2 / 2")).toBeTruthy();

    // Click badge for #1 directly on the canvas overlay
    const badge1 = await screen.findByRole("button", { name: "เลือกจุดที่ 1" });
    fireEvent.click(badge1);
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  test("Smart Fill Box and Clear Box modify the mask and support Undo", async () => {
    renderMaskEditor();

    await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });

    fireEvent.click(screen.getByText("ตัวเลือกเพิ่มเติม"));
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


test("keeps unsaved strokes when switching regions and back", async () => {
  const region2: CleaningRegion = { ...preservedRegion, id: "region-2", rect: { x: 40, y: 40, width: 20, height: 12 } };
  const { container } = renderMaskEditor({ regions: [preservedRegion, region2] });
  const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
  expect(container.querySelector("canvas")).toBeTruthy();
  const flushLoads = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  await flushLoads();
  const sharedCtx = (canvas as HTMLCanvasElement).getContext("2d") as unknown as {
    putImageData: ReturnType<typeof vi.fn>;
  };
  const lastImage = () => sharedCtx.putImageData.mock.calls.at(-1)?.[0] as ImageData;
  const alphaAt = (img: ImageData, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

  // Paint one stroke on region-1 (brush paint alpha is 255)
  await act(async () => {
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 30, clientY: 40, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
  });
  expect(alphaAt(lastImage(), 30, 40)).toBe(255);

  // Switch to region-2, then back to region-1
  await act(async () => {
    fireEvent.change(screen.getByLabelText("จุดที่แก้ไข"), { target: { value: "region-2" } });
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("จุดที่แก้ไข"), { target: { value: "region-1" } });
    await new Promise((r) => setTimeout(r, 0));
  });

  const restored = lastImage();
  expect(alphaAt(restored, 30, 40)).toBe(255);
  expect(alphaAt(restored, 11, 11)).toBe(150);
});
