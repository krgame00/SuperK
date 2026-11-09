import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { MaskEditor } from "@/components/cleaning/MaskEditor";
import type { CleaningRegion } from "@/lib/cleaning/types";
import { undoManager } from "@/lib/undoManager";

const testRegion1: CleaningRegion = {
  id: "region-1",
  rect: { x: 10, y: 10, width: 30, height: 20 },
  route: "flat",
  confidence: 0.9,
  status: "preserved",
  residualScore: 0,
  damageScore: 0,
  pageRole: "comic",
  textRole: "review",
  textConfirmed: true,
  eligibilityConfidence: 0.7,
  automaticAction: "preserve",
  protectionReasons: ["low-confidence"],
};

const testRegion2: CleaningRegion = {
  ...testRegion1,
  id: "region-2",
  rect: { x: 50, y: 40, width: 25, height: 18 },
  textConfirmed: true,
};

describe("MaskEditor - All Buttons Comprehensive Verification", () => {
  let onCloseMock: any;
  let onRetryMock: any;

  beforeEach(() => {
    undoManager.clear();
    onCloseMock = vi.fn();
    onRetryMock = vi.fn().mockResolvedValue({ cleanUrl: "blob:mock-clean", maskUrl: "blob:mock-mask" });

    // Mock Image
    class MockImage {
      naturalWidth = 120;
      naturalHeight = 100;
      width = 120;
      height = 100;
      onload: (() => void) | null = null;
      private _src = "";
      set src(val: string) {
        this._src = val;
        setTimeout(() => this.onload?.(), 0);
      }
      get src() {
        return this._src;
      }
    }
    vi.stubGlobal("Image", MockImage);

    // Mock Canvas Context
    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn((_x, _y, w, h) => {
        const width = w || 120;
        const height = h || 100;
        const data = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
        // Paint some active mask pixels in region 1
        for (let y = 12; y < 20; y++) {
          for (let x = 12; x < 25; x++) {
            const idx = (y * width + x) * 4;
            data.data[idx] = 255;
            data.data[idx + 3] = 150;
          }
        }
        return data;
      }),
      putImageData: vi.fn(),
      createImageData: vi.fn((w, h) => new ImageData(w || 120, h || 100)),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    };

    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => mockContext as unknown as CanvasRenderingContext2D,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 120,
      height: 100,
      right: 120,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => cb(new Blob(["mock-mask"]))) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,mockbase64strip");
  });

  function renderEditor() {
    return render(
      <MaskEditor
        sourceUrl="blob:mock-source"
        cleanUrl="blob:mock-cleaned"
        maskUrl="blob:mock-mask"
        regions={[testRegion1, testRegion2]}
        onClose={onCloseMock}
        onRetry={onRetryMock}
      />,
    );
  }

  test("1. Zoom toolbar buttons: Zoom In, Zoom Out, Reset, and Fit Screen", async () => {
    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    const zoomInBtn = screen.getByRole("button", { name: "ซูมเข้า" });
    const zoomOutBtn = screen.getByRole("button", { name: "ซูมออก" });
    const resetZoomBtn = screen.getByTitle("คลิกเพื่อรีเซ็ตขนาดภาพ");
    const fitScreenBtn = screen.getByRole("button", { name: "พอดีหน้าจอ" });

    expect(resetZoomBtn).toHaveTextContent("100%");

    // Click Zoom In
    fireEvent.click(zoomInBtn);
    expect(screen.getByTitle("คลิกเพื่อรีเซ็ตขนาดภาพ")).toHaveTextContent("125%");

    // Click Zoom Out
    fireEvent.click(zoomOutBtn);
    expect(screen.getByTitle("คลิกเพื่อรีเซ็ตขนาดภาพ")).toHaveTextContent("100%");

    // Zoom out further
    fireEvent.click(zoomOutBtn);
    expect(screen.getByTitle("คลิกเพื่อรีเซ็ตขนาดภาพ")).toHaveTextContent("75%");

    // Reset Zoom via percentage button
    fireEvent.click(resetZoomBtn);
    expect(screen.getByTitle("คลิกเพื่อรีเซ็ตขนาดภาพ")).toHaveTextContent("100%");

    // Zoom in then reset via Fit Screen
    fireEvent.click(zoomInBtn);
    fireEvent.click(fitScreenBtn);
    expect(screen.getByTitle("คลิกเพื่อรีเซ็ตขนาดภาพ")).toHaveTextContent("100%");
  });

  test("2. Region navigation buttons: Next, Previous, and Region Badges", async () => {
    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    const nextBtn = screen.getByRole("button", { name: "จุดถัดไป" });
    const prevBtn = screen.getByRole("button", { name: "จุดก่อนหน้า" });
    const regionSelect = screen.getByLabelText("จุดที่แก้ไข");

    expect(regionSelect).toHaveValue("region-1");

    // Click Next
    fireEvent.click(nextBtn);
    expect(regionSelect).toHaveValue("region-2");

    // Click Previous
    fireEvent.click(prevBtn);
    expect(regionSelect).toHaveValue("region-1");

    // Click interactive region badge overlay on canvas
    const badge2 = screen.getByRole("button", { name: "เลือกจุดที่ 2" });
    fireEvent.click(badge2);
    expect(regionSelect).toHaveValue("region-2");

    const badge1 = screen.getByRole("button", { name: "เลือกจุดที่ 1" });
    fireEvent.click(badge1);
    expect(regionSelect).toHaveValue("region-1");
  });

  test("3. Header Close button calls onClose", async () => {
    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    const closeBtn = screen.getByRole("button", { name: "ปิดแก้ Mask" });
    fireEvent.click(closeBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  test("4. Image comparison buttons switch views", async () => {
    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    const cleanedBtn = screen.getByRole("button", { name: "ภาพที่คลีนแล้ว" });
    const originalBtn = screen.getByRole("button", { name: "ภาพเดิม" });

    // Switch to cleaned
    fireEvent.click(cleanedBtn);
    expect(cleanedBtn).toHaveAttribute("aria-pressed", "true");
    expect(originalBtn).toHaveAttribute("aria-pressed", "false");

    // Switch back to original
    fireEvent.click(originalBtn);
    expect(originalBtn).toHaveAttribute("aria-pressed", "true");
    expect(cleanedBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("5. AI Mask Inspector and Diff View buttons", async () => {
    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    const aiAuditBtn = screen.getByRole("button", { name: "AI ตรวจ/เทียบ Mask" });
    expect(aiAuditBtn).not.toBeDisabled();

    // Click AI Audit button
    fireEvent.click(aiAuditBtn);

    const diffRegion = await screen.findByRole("region", { name: "ผลเปรียบเทียบ AI Mask" });
    expect(diffRegion).toBeInTheDocument();

    // Test sub-buttons inside AI Audit bar
    const origMaskTab = screen.getByRole("button", { name: "Mask เดิม" });
    const aiMaskTab = screen.getByRole("button", { name: "Mask ของ AI" });
    const diffTab = screen.getByRole("button", { name: "เทียบจุดต่าง (Diff)" });
    const closeAuditBtn = screen.getByRole("button", { name: "ปิดผลเทียบ" });

    fireEvent.click(origMaskTab);
    fireEvent.click(aiMaskTab);
    fireEvent.click(diffTab);

    // Test Close Audit button
    fireEvent.click(closeAuditBtn);
    expect(screen.queryByRole("region", { name: "ผลเปรียบเทียบ AI Mask" })).not.toBeInTheDocument();

    // Reopen and apply AI mask button
    fireEvent.click(screen.getByRole("button", { name: "AI ตรวจ/เทียบ Mask" }));
    const applyAiBtn = await screen.findByRole("button", { name: "นำ Mask ของ AI มาใช้" });
    fireEvent.click(applyAiBtn);

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "ผลเปรียบเทียบ AI Mask" })).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("นำ Mask ที่ AI แนะนำมาใช้แล้ว");
    });
  });

  test("6. Gemini Vision Mask Review button calls /api/mask-review and refines mask", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        verdict: "under_masked",
        summary: "พบตัวอักษรบางส่วนยังไม่ได้ Mask",
        addBoxes: [[100, 100, 300, 300]],
        protectBoxes: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    const geminiBtn = screen.getByRole("button", { name: "ให้ Gemini วิเคราะห์จุดนี้" });
    expect(geminiBtn).not.toBeDisabled();

    fireEvent.click(geminiBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/mask-review",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const diffRegion = await screen.findByRole("region", { name: "ผลเปรียบเทียบ AI Mask" });
    expect(diffRegion).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gemini: พบตัวอักษรบางส่วนยังไม่ได้ Mask");
  });

  test("7. Brush tool mode buttons, slider, undo, and dilation", async () => {
    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    // Mode buttons: ลบข้อความ (paint), ไม่ลบตรงนี้ (erase), กู้เฉพาะส่วน (restore)
    const paintBtn = screen.getByRole("button", { name: "ลบข้อความ" });
    const restoreBtn = screen.getByRole("button", { name: "กู้เฉพาะส่วน" });
    const eraseBtn = screen.getByRole("button", { name: "ไม่ลบตรงนี้" });

    fireEvent.click(restoreBtn);
    expect(restoreBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(eraseBtn);
    expect(eraseBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(paintBtn);
    expect(paintBtn).toHaveAttribute("aria-pressed", "true");

    // Radius slider
    const radiusSlider = screen.getByRole("slider");
    fireEvent.change(radiusSlider, { target: { value: "24" } });
    expect(screen.getByRole("status")).toHaveTextContent("ขนาดแปรง 24 พิกเซล");

    // Undo button
    const undoBtn = screen.getByRole("button", { name: "Undo Mask" });
    fireEvent.click(undoBtn);

    // Dilation select
    const dilationSelect = screen.getByRole("combobox", { name: "ขยายขอบ Mask" });
    fireEvent.change(dilationSelect, { target: { value: "3" } });
    expect(dilationSelect).toHaveValue("3");
  });

  test("8. Region Quick Actions: Fill, Clear, Restore Whole, and Fast Inpaint", async () => {
    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    // Open options accordion
    const optionsToggle = screen.getByText("ตัวเลือกเพิ่มเติม");
    fireEvent.click(optionsToggle);

    // Fill Region
    const fillBtn = screen.getByRole("button", { name: "เติมเต็มกรอบ" });
    fireEvent.click(fillBtn);
    expect(screen.getByRole("status")).toHaveTextContent("เติม Mask เต็มกรอบแล้ว");

    // Clear Region
    const clearBtn = screen.getByRole("button", { name: "ล้างกรอบนี้" });
    fireEvent.click(clearBtn);
    expect(screen.getByRole("status")).toHaveTextContent("ล้าง Mask ในกรอบแล้ว");

    // Restore Whole Region
    const restoreWholeBtn = screen.getByRole("button", { name: "กู้ภาพเดิมทั้งจุด" });
    fireEvent.click(restoreWholeBtn);
    await waitFor(() => {
      expect(onRetryMock).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "protect");
    });

    // Fast Inpaint Button
    const fastInpaintBtn = screen.getByRole("button", { name: "⚡ คลีนทันที" });
    expect(fastInpaintBtn).not.toBeDisabled();
  });

  test("9. Footer Action buttons: One-Click Clean, Confirm Text, Protect, and Force Clean", async () => {
    renderEditor();
    const canvas = await screen.findByRole("application", { name: "พื้นที่แก้ Mask" });
    await waitFor(() => expect(canvas).toHaveAttribute("width", "120"));

    // 1-Click Clean button ("ใช้กับจุดนี้")
    const oneClickBtn = screen.getByRole("button", { name: "ใช้กับจุดนี้" });
    expect(oneClickBtn).not.toBeDisabled();
    fireEvent.click(oneClickBtn);

    await waitFor(() => {
      expect(onRetryMock).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "force-clean");
    });

    // Open options accordion for granular authorization buttons
    const optionsToggle = screen.getByText("ตัวเลือกเพิ่มเติม");
    fireEvent.click(optionsToggle);

    // Confirm Text button
    const confirmBtn = screen.getByRole("button", { name: "ยืนยันว่าเป็นข้อความ" });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(onRetryMock).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "confirm-text");
    });

    // Protect button
    const protectBtn = screen.getByRole("button", { name: "Protect" });
    fireEvent.click(protectBtn);
    await waitFor(() => {
      expect(onRetryMock).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "protect");
    });

    // Force Clean button ("อนุมัติ Mask และลบ")
    const forceCleanBtn = screen.getByRole("button", { name: "อนุมัติ Mask และลบ" });
    fireEvent.click(forceCleanBtn);
    await waitFor(() => {
      expect(onRetryMock).toHaveBeenCalledWith("region-1", expect.any(Blob), "auto", "force-clean");
    });
  });
});
