import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UndoManager,
  DEFAULT_MAX_UNDO_STATES,
  DEFAULT_MAX_RASTER_UNDO_STATES,
} from "../../lib/undoManager";

describe("UndoManager Dual-Tier Memory Management", () => {
  let manager: UndoManager;

  beforeEach(() => {
    manager = new UndoManager();
  });

  it("handles simple generic undo and redo", () => {
    let state = 0;
    manager.push({
      label: "Increment",
      undo: () => { state--; },
      redo: () => { state++; },
    });
    state = 1;

    expect(manager.canUndo()).toBe(true);
    expect(manager.canRedo()).toBe(false);

    const undoLabel = manager.undo();
    expect(undoLabel).toBe("Increment");
    expect(state).toBe(0);
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(true);

    const redoLabel = manager.redo();
    expect(redoLabel).toBe("Increment");
    expect(state).toBe(1);
  });

  it("disposes forward redo actions when a new action is pushed", () => {
    const dispose1 = vi.fn();
    const dispose2 = vi.fn();
    const dispose3 = vi.fn();

    manager.push({ label: "Action 1", undo: vi.fn(), redo: vi.fn(), dispose: dispose1 });
    manager.push({ label: "Action 2", undo: vi.fn(), redo: vi.fn(), dispose: dispose2 });

    // Undo action 2
    manager.undo();
    expect(dispose2).not.toHaveBeenCalled();

    // Push new Action 3 ahead of Action 1, cutting Action 2 from redo branch
    manager.push({ label: "Action 3", undo: vi.fn(), redo: vi.fn(), dispose: dispose3 });

    expect(dispose2).toHaveBeenCalledTimes(1);
    expect(dispose1).not.toHaveBeenCalled();
    expect(dispose3).not.toHaveBeenCalled();
    expect(manager.canRedo()).toBe(false);
  });

  it("enforces MAX_UNDO_STATES limit and disposes evicted actions", () => {
    const customManager = new UndoManager(3, 3);
    const disposers = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];

    customManager.push({ label: "1", undo: vi.fn(), redo: vi.fn(), dispose: disposers[0] });
    customManager.push({ label: "2", undo: vi.fn(), redo: vi.fn(), dispose: disposers[1] });
    customManager.push({ label: "3", undo: vi.fn(), redo: vi.fn(), dispose: disposers[2] });

    expect(customManager.getStackSize()).toBe(3);
    expect(disposers[0]).not.toHaveBeenCalled();

    // 4th action pushes stack beyond maxSize 3
    customManager.push({ label: "4", undo: vi.fn(), redo: vi.fn(), dispose: disposers[3] });

    expect(customManager.getStackSize()).toBe(3);
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    expect(disposers[1]).not.toHaveBeenCalled();
  });

  it("enforces MAX_RASTER_UNDO_STATES limit and disposes evicted raster states", () => {
    // 10 max general states, but strictly 3 max raster states
    const customManager = new UndoManager(10, 3);
    const rasterDisposers = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const genericDisposer = vi.fn();

    customManager.push({ label: "G1", kind: "generic", undo: vi.fn(), redo: vi.fn(), dispose: genericDisposer });
    customManager.push({ label: "R1", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: rasterDisposers[0] });
    customManager.push({ label: "R2", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: rasterDisposers[1] });
    customManager.push({ label: "R3", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: rasterDisposers[2] });

    expect(customManager.getStackSize()).toBe(4);
    expect(customManager.getRasterCount()).toBe(3);
    expect(rasterDisposers[0]).not.toHaveBeenCalled();

    // Pushing 4th raster action must evict R1, but KEEP G1
    customManager.push({ label: "R4", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: rasterDisposers[3] });

    expect(customManager.getRasterCount()).toBe(3);
    expect(rasterDisposers[0]).toHaveBeenCalledTimes(1); // R1 was disposed
    expect(genericDisposer).not.toHaveBeenCalled(); // G1 was preserved!
    expect(customManager.getStackSize()).toBe(4); // G1 + R2 + R3 + R4
  });

  it("adjusts pointer correctly when an older raster action behind pointer is pruned", () => {
    const customManager = new UndoManager(10, 2);
    const d1 = vi.fn();
    const d2 = vi.fn();
    const d3 = vi.fn();

    customManager.push({ label: "R1", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: d1 });
    customManager.push({ label: "R2", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: d2 });
    expect(customManager.getPointer()).toBe(1);

    // Pushing R3 exceeds max 2 raster states. R1 is pruned at index 0 (behind pointer 1)
    customManager.push({ label: "R3", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: d3 });

    // Pointer was 2 upon push, but adjusted to 1 because index 0 was spliced
    expect(customManager.getPointer()).toBe(1);
    expect(customManager.canUndo()).toBe(true);

    const action = customManager.undo();
    expect(action).toBe("R3");
  });

  it("disposes all remaining actions when clear() is called", () => {
    const d1 = vi.fn();
    const d2 = vi.fn();
    const d3 = vi.fn();

    manager.push({ label: "A1", kind: "generic", undo: vi.fn(), redo: vi.fn(), dispose: d1 });
    manager.push({ label: "A2", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: d2 });
    manager.push({ label: "A3", kind: "raster", undo: vi.fn(), redo: vi.fn(), dispose: d3 });

    expect(manager.getStackSize()).toBe(3);
    manager.clear();

    expect(manager.getStackSize()).toBe(0);
    expect(manager.getPointer()).toBe(-1);
    expect(d1).toHaveBeenCalledTimes(1);
    expect(d2).toHaveBeenCalledTimes(1);
    expect(d3).toHaveBeenCalledTimes(1);
  });

  it("gracefully catches errors thrown in dispose callbacks", () => {
    const faultyDispose = vi.fn(() => {
      throw new Error("Disposal error");
    });
    const goodDispose = vi.fn();

    const customManager = new UndoManager(1, 1);
    customManager.push({ label: "Faulty", undo: vi.fn(), redo: vi.fn(), dispose: faultyDispose });

    // Pushing second action evicts first action and executes faultyDispose
    expect(() => {
      customManager.push({ label: "Good", undo: vi.fn(), redo: vi.fn(), dispose: goodDispose });
    }).not.toThrow();

    expect(faultyDispose).toHaveBeenCalledTimes(1);
  });
});
