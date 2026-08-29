import { describe, it, expect, beforeEach } from "vitest";
import {
  readOverlayAdjustments,
  saveOverlayAdjustments,
  clearPageAdjustments,
  clearAllAdjustments,
} from "@/lib/translationOverlay";

describe("Translation Overlay Adjustments Persistence", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    const mockStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
    };

    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });

    if (typeof window !== "undefined") {
      Object.defineProperty(window, "localStorage", {
        value: mockStorage,
        writable: true,
        configurable: true,
      });
    }
  });

  it("reads and saves adjustments to localStorage", () => {
    const data = {
      "page-0": {
        "100,200,300,400": {
          bx: 150,
          by: 250,
          bw: 120,
          bh: 80,
          iw: 800,
          ih: 1200,
        },
      },
    };

    saveOverlayAdjustments(data);
    const read = readOverlayAdjustments();
    expect(read["page-0"]["100,200,300,400"].bx).toBe(150);
    expect(read["page-0"]["100,200,300,400"].by).toBe(250);
  });

  it("clears only the target page adjustments with clearPageAdjustments", () => {
    const data = {
      "page-0": {
        "box-1": { bx: 10, by: 10, bw: 50, bh: 50, iw: 100, ih: 100 },
      },
      "page-1": {
        "box-2": { bx: 20, by: 20, bw: 60, bh: 60, iw: 100, ih: 100 },
      },
    };

    saveOverlayAdjustments(data);
    clearPageAdjustments(0);

    const read = readOverlayAdjustments();
    expect(read["page-0"]).toBeUndefined();
    expect(read["page-1"]["box-2"].bx).toBe(20);
  });

  it("clears all adjustments with clearAllAdjustments", () => {
    const data = {
      "page-0": {
        "box-1": { bx: 10, by: 10, bw: 50, bh: 50, iw: 100, ih: 100 },
      },
    };

    saveOverlayAdjustments(data);
    clearAllAdjustments();

    const read = readOverlayAdjustments();
    expect(Object.keys(read)).toHaveLength(0);
  });
});