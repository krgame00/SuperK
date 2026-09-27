import { describe, expect, it } from "vitest";
import { readabilityAcknowledgmentKey } from "@/lib/export/readabilityAcknowledgment";

const finding = { pageUrl: "page", pageIndex: 0, bubbleId: "bubble", text: "text", kind: "overflow" as const };

describe("readability warning acknowledgment", () => {
  it("matches the same warnings at the same revision across export formats", () => {
    const page = { pageUrl: "page", revision: "rev-1", findings: [finding] };
    expect(readabilityAcknowledgmentKey([page])).toBe(readabilityAcknowledgmentKey([page]));
    expect(readabilityAcknowledgmentKey([{ ...page, revision: "rev-2" }])).not.toBe(readabilityAcknowledgmentKey([page]));
  });

  it("never acknowledges unknown or unfinished results", () => {
    expect(readabilityAcknowledgmentKey([{ pageUrl: "page", revision: "rev-1", findings: [finding], unavailable: "no image" }])).toBeNull();
    expect(readabilityAcknowledgmentKey([{ pageUrl: "page", revision: "rev-1", findings: [{ ...finding, kind: "color-unavailable" }] }])).toBeNull();
    expect(readabilityAcknowledgmentKey([{ pageUrl: "page", revision: "rev-1", findings: [] }])).toBeNull();
  });
});
