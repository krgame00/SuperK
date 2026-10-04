import { describe, expect, it } from "vitest";
import { LANGUAGE_POLICY_VERSION } from "@/lib/languagePolicy";
import { isReviewCurrent, withReviewIdentity } from "@/lib/translation/qualityReview";

describe("G03 exact source/text/target/policy snapshots control approval validity", () => {
  it("keeps snapshots recorded under the current policy version current", () => {
    const bubble = {
      t: "รอ",
      original_text: "Wait",
      translationReview: withReviewIdentity(
        { status: "ok", sourceText: "Wait", reviewedText: "รอ" },
        "th",
        "rev-1",
      ),
    };
    expect(bubble.translationReview.policyVersion).toBe(LANGUAGE_POLICY_VERSION);
    expect(isReviewCurrent(bubble)).toBe(true);
  });

  it("invalidates approval recorded under a different policy version", () => {
    const bubble = {
      t: "รอ",
      original_text: "Wait",
      translationReview: {
        ...withReviewIdentity({ status: "ok", sourceText: "Wait", reviewedText: "รอ" }, "th"),
        policyVersion: "strict-script-v0",
      },
    };
    expect(isReviewCurrent(bubble)).toBe(false);
    expect(isReviewCurrent(bubble, "th")).toBe(false);
  });
});
