import { describe, expect, it } from "vitest";
import { LANGUAGE_POLICY_VERSION } from "@/lib/languagePolicy";
import { verifyWorkspaceHandoff } from "@/lib/extension/workspaceHandoff";
import { withReviewIdentity } from "@/lib/translation/qualityReview";

const sha = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
const sourceImage = "data:image/png;base64,YQ==";

describe("extension workspace handoff source binding", () => {
  it("verifies original bytes and retains only an exact current review identity", async () => {
    const identity = { targetId: "th", policyVersion: LANGUAGE_POLICY_VERSION };
    const review = withReviewIdentity({ status: "ok", sourceText: "source", reviewedText: "ไทย" }, "th", sha);
    const result = await verifyWorkspaceHandoff({ pageUrl: "https://reader.test/page/image-1.png", sourceImage, sourceRevision: sha, targetIdentity: identity, bubbles: [{ t: "ไทย", original_text: "source", translationReview: review }] });
    expect(result).toMatchObject({ pageUrl: sourceImage, readerImageUrl: "https://reader.test/page/image-1.png", sourceRevision: sha, targetIdentity: identity });
    expect(result.bubbles[0].translationReview?.status).toBe("ok");
  });

  it("rejects unavailable or mismatched original bytes rather than rebinding approvals", async () => {
    await expect(verifyWorkspaceHandoff({ pageUrl: "https://reader.test/a", sourceRevision: sha, targetIdentity: { targetId: "th", policyVersion: LANGUAGE_POLICY_VERSION } })).rejects.toThrow("ภาพต้นฉบับ");
    await expect(verifyWorkspaceHandoff({ pageUrl: "https://reader.test/a", sourceImage, sourceRevision: "b".repeat(64) })).rejects.toThrow("ไม่ตรง");
  });

  it("opens the original page but marks old reviews stale when their target identity changed", async () => {
    const review = withReviewIdentity({ status: "ok", sourceText: "source", reviewedText: "ไทย" }, "th", sha);
    const result = await verifyWorkspaceHandoff({ pageUrl: "https://reader.test/a", sourceImage, sourceRevision: sha, targetIdentity: { targetId: "xx", policyVersion: "old" }, bubbles: [{ t: "ไทย", original_text: "source", translationReview: review }] });
    expect(result.targetIdentity).toBeUndefined();
    expect(result.bubbles[0].translationReview?.status).toBe("stale");
  });
});
