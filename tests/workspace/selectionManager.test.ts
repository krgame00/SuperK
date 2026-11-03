import { describe, expect, it } from "vitest";
import {
  INITIAL_SELECTION_STATE,
  selectionReducer,
} from "@/lib/inspector/selectionManager";

describe("selectionReducer", () => {
  it("selects a bubble with idempotent repeat select", () => {
    const s1 = selectionReducer(INITIAL_SELECTION_STATE, {
      type: "SELECT",
      id: "bubble_1",
      pointerId: 101,
    });
    expect(s1.selectedId).toBe("bubble_1");
    expect(s1.capturedPointerId).toBe(101);

    // Idempotent select of same id and pointer
    const s2 = selectionReducer(s1, {
      type: "SELECT",
      id: "bubble_1",
      pointerId: 101,
    });
    expect(s2).toBe(s1);
  });

  it("handles deselect cleanly", () => {
    const s1 = selectionReducer(INITIAL_SELECTION_STATE, {
      type: "SELECT",
      id: "bubble_1",
      pointerId: 101,
    });
    const s2 = selectionReducer(s1, { type: "DESELECT" });
    expect(s2.selectedId).toBeNull();
    expect(s2.isDragging).toBe(false);
    expect(s2.capturedPointerId).toBeNull();
  });

  it("recovers from lost pointer capture without stuck drag", () => {
    const s1 = selectionReducer(INITIAL_SELECTION_STATE, {
      type: "DRAG_START",
      pointerId: 42,
    });
    expect(s1.isDragging).toBe(true);
    expect(s1.capturedPointerId).toBe(42);

    const s2 = selectionReducer(s1, { type: "POINTER_LOST" });
    expect(s2.isDragging).toBe(false);
    expect(s2.capturedPointerId).toBeNull();
  });
});
