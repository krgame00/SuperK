import { describe, it, expect } from "vitest";
import {
  renderWarpedText,
  type WarpConfig,
  type WarpEffectType,
  getNextWarpType,
  getWarpLabel,
} from "../../lib/tools/TextWarpRenderer";

describe("TextWarpRenderer", () => {
  it("cycles warp types in sequence", () => {
    expect(getNextWarpType("none")).toBe("arch");
    expect(getNextWarpType("arch")).toBe("wave");
    expect(getNextWarpType("wave")).toBe("bulge");
    expect(getNextWarpType("bulge")).toBe("squeeze");
    expect(getNextWarpType("squeeze")).toBe("none");
  });

  it("provides informative labels for each warp type", () => {
    expect(getWarpLabel("none")).toContain("ปกติ");
    expect(getWarpLabel("arch")).toContain("โค้ง");
    expect(getWarpLabel("wave")).toContain("คลื่น");
    expect(getWarpLabel("bulge")).toContain("ป่องกลาง");
    expect(getWarpLabel("squeeze")).toContain("บีบกลาง");
  });

  it("renders without error for each warp type", () => {
    const draws: Array<{ sx: number; destX: number; destY: number; scaleY: number }> = [];

    const mockDestCtx = {
      drawImage: (_img: unknown, sx: number, _sy: number, _sw: number, _sh: number, dx: number, dy: number, _dw: number, dh: number) => {
        draws.push({ sx, destX: dx, destY: dy, scaleY: dh });
      },
    } as unknown as CanvasRenderingContext2D;

    const mockSource = {
      width: 100,
      height: 40,
    } as unknown as OffscreenCanvas;

    // none: straight drawImage
    draws.length = 0;
    renderWarpedText(mockDestCtx, mockSource, 10, 20, { type: "none", bend: 0.5, frequency: 1.5 });
    expect(draws.length).toBe(1);

    // arch: slices along width
    draws.length = 0;
    renderWarpedText(mockDestCtx, mockSource, 0, 0, { type: "arch", bend: 0.5, frequency: 1.5 });
    expect(draws.length).toBeGreaterThan(1);
    // Middle slices should have different offsetY compared to edges
    const firstSlice = draws[0];
    const middleSlice = draws[Math.floor(draws.length / 2)];
    expect(middleSlice.destY).not.toBe(firstSlice.destY);

    // wave: oscillation
    draws.length = 0;
    renderWarpedText(mockDestCtx, mockSource, 0, 0, { type: "wave", bend: 0.5, frequency: 1.5 });
    expect(draws.length).toBeGreaterThan(1);

    // bulge: height scales in the middle
    draws.length = 0;
    renderWarpedText(mockDestCtx, mockSource, 0, 0, { type: "bulge", bend: 0.5, frequency: 1.5 });
    expect(draws.length).toBeGreaterThan(1);
    const middleBulge = draws[Math.floor(draws.length / 2)];
    expect(middleBulge.scaleY).toBeGreaterThan(40); // 40 * (1 + bulge) > 40
  });
});
