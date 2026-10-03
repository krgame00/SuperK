import { describe, expect, it } from "vitest";

import {
  shouldReuseCachedTranslatedRender,
} from "@/lib/export/renderFreshness";

describe("export translated-render freshness", () => {
  it("does not reuse an in-memory translated render after the page was edited", () => {
    expect(shouldReuseCachedTranslatedRender(true)).toBe(false);
    expect(shouldReuseCachedTranslatedRender(false)).toBe(true);
  });
});
