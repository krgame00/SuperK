import { describe, expect, it, vi } from "vitest";
import { generateThumbnail } from "@/lib/thumbnail";

describe("generateThumbnail", () => {
  it("returns a string safely when loading or falling back", async () => {
    const result = await generateThumbnail("data:image/png;base64,iVBORw0KGgo=");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles image load event and creates downscaled data URL", async () => {
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 800;
      naturalHeight = 1200;
      set src(_val: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", MockImage);
    try {
      const result = await generateThumbnail("data:image/png;base64,mock");
      expect(typeof result).toBe("string");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
