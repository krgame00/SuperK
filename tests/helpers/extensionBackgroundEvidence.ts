import { revisionKeyOf, type BackgroundInspectionResult } from "@/lib/cleaning/backgroundRemnantInspection";

export const TEST_CLEAN_DATA_URL = "data:image/png;base64,YQ==";
export const TEST_CLEAN_SHA256 = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

export function inspectedBackgroundEvidence(sourceRevision: string, backgroundRevision = TEST_CLEAN_SHA256) {
  const revisions = { sourceRevision, backgroundRevision, removalRevision: "mask-revision" };
  const revisionKey = revisionKeyOf(revisions)!;
  const backgroundEvidence: BackgroundInspectionResult = {
    status: "inspected",
    revisionKey,
    revisions,
    candidates: [],
    inspectedAreas: 1,
  };
  return { backgroundEvidence, backgroundState: "approved" as const, backgroundRevision: revisionKey };
}
