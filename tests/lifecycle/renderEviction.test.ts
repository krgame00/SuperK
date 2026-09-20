import { describe, expect, it } from "vitest";
import { WorkspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";

describe("render cache memory ownership", () => {
  it("drops an oversized render instead of retaining it outside the budget", () => {
    const manager = new WorkspaceResourceManager({ minCapMB: 1, maxCapMB: 1 });
    const evicted = manager.registerRenderedImage("page", "rev-1", "data:large", 2 * 1024 * 1024);
    expect(evicted).toEqual(["page:translated-render"]);
    expect(manager.getCurrentUsageBytes()).toBe(0);
    expect(manager.restoreRenderedImage("page", "rev-1")).toBeNull();
  });

  it("does not accumulate recoverable renders outside the budget across 100 pages", () => {
    const manager = new WorkspaceResourceManager({ minCapMB: 2, maxCapMB: 2 });
    for (let i = 0; i < 100; i++) {
      manager.registerRenderedImage(`page_${i}`, "rev-1", `data:render-${i}`, 1024 * 1024);
    }
    expect(manager.getCurrentUsageBytes()).toBe(2 * 1024 * 1024);
    for (let i = 0; i < 98; i++) {
      expect(manager.restoreRenderedImage(`page_${i}`, "rev-1")).toBeNull();
    }
    expect(manager.restoreRenderedImage("page_99", "rev-1")).toBe("data:render-99");
    // A caller can rebuild an evicted render from the saved bubbles/edits.
    manager.registerRenderedImage("page_0", "rev-2", "data:rebuilt", 1024 * 1024);
    expect(manager.restoreRenderedImage("page_0", "rev-2")).toBe("data:rebuilt");
    expect(manager.getCurrentUsageBytes()).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
});
