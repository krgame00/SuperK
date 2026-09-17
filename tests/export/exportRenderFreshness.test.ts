import { describe, expect, it } from "vitest";

import {
  shouldReuseCachedTranslatedRender,
  shouldReuseSpilledTranslatedRender,
} from "@/lib/export/renderFreshness";

describe("export translated-render freshness", () => {
  it("does not reuse an in-memory translated render after the page was edited", () => {
    expect(shouldReuseCachedTranslatedRender(true)).toBe(false);
    expect(shouldReuseCachedTranslatedRender(false)).toBe(true);
  });

  it("re-renders from authoritative bubbles instead of reusing a spilled render when bubbles exist", () => {
    expect(shouldReuseSpilledTranslatedRender([{ t: "แก้แล้ว", box: [100, 100, 300, 400] }])).toBe(false);
  });

  it("may reuse a spilled render when there are no translated bubbles to re-render", () => {
    expect(shouldReuseSpilledTranslatedRender([])).toBe(true);
    expect(shouldReuseSpilledTranslatedRender(undefined)).toBe(true);
  });
});
