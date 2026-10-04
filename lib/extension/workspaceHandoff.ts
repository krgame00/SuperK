import { createPageTargetIdentity, type PageTargetIdentity } from "@/lib/translation/pageEligibility";
import { isReviewCurrent } from "@/lib/translation/qualityReview";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import { originalSourceFingerprint } from "./sourceFingerprint";

export interface VerifiedWorkspaceHandoff {
  pageUrl: string;
  readerImageUrl: string;
  sourceRevision: string;
  targetIdentity?: PageTargetIdentity;
  bubbles: TranslatedBubble[];
}

/** Verify the actual original image bytes before allowing saved review evidence into a workspace. */
export async function verifyWorkspaceHandoff(input: {
  pageUrl?: unknown;
  sourceImage?: unknown;
  sourceRevision?: unknown;
  targetIdentity?: unknown;
  bubbles?: unknown;
}): Promise<VerifiedWorkspaceHandoff> {
  if (typeof input.sourceImage !== "string" || input.sourceImage.length > 28 * 1024 * 1024) {
    throw new Error("ภาพต้นฉบับจากส่วนขยายไม่พร้อมหรือมีขนาดเกินกำหนด");
  }
  if (typeof input.pageUrl !== "string" || !input.pageUrl.trim() || input.pageUrl.length > 8192 || input.pageUrl.startsWith("data:")) {
    throw new Error("URL ภาพต้นฉบับจากส่วนขยายไม่พร้อม");
  }
  const source = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(input.sourceImage);
  if (!source) throw new Error("ข้อมูลภาพต้นฉบับจากส่วนขยายไม่ถูกต้อง");
  const sourceRevision = await originalSourceFingerprint(source[1]);
  if (input.sourceRevision !== sourceRevision) throw new Error("ลายนิ้วมือภาพต้นฉบับไม่ตรงกับข้อมูลจากส่วนขยาย");

  let targetIdentity: PageTargetIdentity | undefined;
  if (input.targetIdentity && typeof input.targetIdentity === "object") {
    const candidate = input.targetIdentity as Partial<PageTargetIdentity>;
    const canonical = typeof candidate.targetId === "string" ? createPageTargetIdentity(candidate.targetId) : undefined;
    if (canonical && candidate.policyVersion === canonical.policyVersion) targetIdentity = canonical;
  }

  const bubbles = Array.isArray(input.bubbles) ? input.bubbles.map((raw): TranslatedBubble => {
    const bubble = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as TranslatedBubble) } : {};
    if (bubble.translationReview && (!targetIdentity || !isReviewCurrent(bubble, targetIdentity.targetId, sourceRevision))) {
      bubble.translationReview = { ...bubble.translationReview, status: "stale" };
    }
    return bubble;
  }) : [];

  return { pageUrl: input.sourceImage, readerImageUrl: input.pageUrl, sourceRevision, targetIdentity, bubbles };
}
