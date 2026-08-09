import { describe, expect, test } from "vitest";

import {
  assertMatchingImageDimensions,
  resolveTranslationOutcome,
} from "@/lib/translationPipeline";

describe("resolveTranslationOutcome", () => {
  test("renders AI bubbles when AI found translatable text", () => {
    const aiBubble = { text: "AI" };

    expect(resolveTranslationOutcome([aiBubble], [])).toEqual({
      kind: "render",
      bubbles: [aiBubble],
    });
  });

  test("renders manual bubbles when AI found no text", () => {
    const manualBubble = { text: "Manual" };

    expect(resolveTranslationOutcome([], [manualBubble])).toEqual({
      kind: "render",
      bubbles: [manualBubble],
    });
  });

  test("returns clean-only when no bubbles exist", () => {
    expect(resolveTranslationOutcome([], [])).toEqual({
      kind: "clean-only",
      bubbles: [],
    });
  });
});

describe("assertMatchingImageDimensions", () => {
  test("accepts equal positive dimensions", () => {
    expect(() =>
      assertMatchingImageDimensions(
        { width: 1200, height: 1800 },
        { width: 1200, height: 1800 },
      ),
    ).not.toThrow();
  });

  test("rejects mismatched dimensions as a cleaning failure", () => {
    expect(() =>
      assertMatchingImageDimensions(
        { width: 1200, height: 1800 },
        { width: 1200, height: 1799 },
      ),
    ).toThrow(/cleaning failed.*dimensions must match/i);
  });

  test("rejects zero dimensions as a cleaning failure", () => {
    expect(() =>
      assertMatchingImageDimensions(
        { width: 0, height: 1800 },
        { width: 0, height: 1800 },
      ),
    ).toThrow(/cleaning failed.*positive/i);
  });
});
