import { describe, it, expect, beforeEach } from "vitest";
import {
  BrushStrokeTracker,
  PerImageUndoManager,
  type DeltaUndoPatch,
} from "../../lib/inpaint/DirtyRectInpainter";

describe("BrushStrokeTracker", () => {
  let tracker: BrushStrokeTracker;

  beforeEach(() => {
    tracker = new BrushStrokeTracker();
  });

  it("returns null when no brush dabs have been recorded", () => {
    expect(tracker.getAlignedCropBox(1000, 1000)).toBeNull();
  });

  it("tracks brush dabs and expands bounding box with padding", () => {
    tracker.recordBrushDab(100, 150, 10);
    tracker.recordBrushDab(200, 250, 20);

    const cropBox = tracker.getAlignedCropBox(1000, 1000, 32, 8);
    expect(cropBox).not.toBeNull();
    if (!cropBox) return;

    // Check bounds:
    // minX was 90, minY was 140, maxX was 220, maxY was 270
    // With padding 32: x0 = max(0, 90 - 32) = 58
    // modulo 8: width aligned to multiple of 8
    expect(cropBox.x).toBeLessThanOrEqual(90 - 32);
    expect(cropBox.y).toBeLessThanOrEqual(140 - 32);
    expect(cropBox.width % 8).toBe(0);
    expect(cropBox.height % 8).toBe(0);
  });

  it("clamps to image boundaries", () => {
    tracker.recordBrushDab(5, 5, 20);
    const cropBox = tracker.getAlignedCropBox(100, 100, 32, 8);
    expect(cropBox).not.toBeNull();
    if (!cropBox) return;

    expect(cropBox.x).toBe(0);
    expect(cropBox.y).toBe(0);
    expect(cropBox.width).toBeLessThanOrEqual(100);
    expect(cropBox.height).toBeLessThanOrEqual(100);
  });

  it("resets state completely on reset()", () => {
    tracker.recordBrushDab(100, 100, 10);
    expect(tracker.getAlignedCropBox(500, 500)).not.toBeNull();
    tracker.reset();
    expect(tracker.getAlignedCropBox(500, 500)).toBeNull();
  });
});

describe("PerImageUndoManager", () => {
  let manager: PerImageUndoManager;

  beforeEach(() => {
    manager = new PerImageUndoManager(3);
  });

  function createMockPatch(pageId: string, id: number): DeltaUndoPatch {
    return {
      pageId,
      x: id * 10,
      y: id * 10,
      width: 50,
      height: 50,
      beforePixels: { data: new Uint8ClampedArray(100), width: 5, height: 5 } as unknown as ImageData,
      afterPixels: { data: new Uint8ClampedArray(100), width: 5, height: 5 } as unknown as ImageData,
    };
  }

  it("pushes patches and manages undo/redo states per page", () => {
    const mockCtx = {
      putImageData: () => {},
    } as unknown as CanvasRenderingContext2D;

    expect(manager.canUndo("page-1")).toBe(false);
    expect(manager.canRedo("page-1")).toBe(false);

    manager.pushPatch(createMockPatch("page-1", 1));
    manager.pushPatch(createMockPatch("page-1", 2));

    expect(manager.canUndo("page-1")).toBe(true);
    expect(manager.canUndo("page-2")).toBe(false);

    const undone = manager.undo("page-1", mockCtx);
    expect(undone).toBe(true);
    expect(manager.canRedo("page-1")).toBe(true);

    const redone = manager.redo("page-1", mockCtx);
    expect(redone).toBe(true);
    expect(manager.canRedo("page-1")).toBe(false);
  });

  it("caps undo history to maxHistoryPerPage and evicts oldest", () => {
    manager.pushPatch(createMockPatch("page-1", 1));
    manager.pushPatch(createMockPatch("page-1", 2));
    manager.pushPatch(createMockPatch("page-1", 3));
    manager.pushPatch(createMockPatch("page-1", 4)); // Should evict patch 1

    const mockCtx = { putImageData: () => {} } as unknown as CanvasRenderingContext2D;

    expect(manager.undo("page-1", mockCtx)).toBe(true); // patch 4
    expect(manager.undo("page-1", mockCtx)).toBe(true); // patch 3
    expect(manager.undo("page-1", mockCtx)).toBe(true); // patch 2
    expect(manager.undo("page-1", mockCtx)).toBe(false); // patch 1 was evicted!
  });

  it("clears page history cleanly", () => {
    manager.pushPatch(createMockPatch("page-1", 1));
    manager.pushPatch(createMockPatch("page-2", 1));

    manager.clear("page-1");
    expect(manager.canUndo("page-1")).toBe(false);
    expect(manager.canUndo("page-2")).toBe(true);

    manager.clear();
    expect(manager.canUndo("page-2")).toBe(false);
  });
});

describe("executeDirtyRectInpaint", () => {
  it("returns null when no brush strokes recorded", async () => {
    const { executeDirtyRectInpaint } = await import(
      "../../lib/inpaint/DirtyRectInpainter"
    );
    const tracker = new BrushStrokeTracker();
    const fakeCanvas = {
      width: 100,
      height: 100,
      getContext: () => ({}),
    } as unknown as HTMLCanvasElement;

    const res = await executeDirtyRectInpaint(
      "page-1",
      fakeCanvas,
      fakeCanvas,
      tracker
    );
    expect(res).toBeNull();
  });
});

