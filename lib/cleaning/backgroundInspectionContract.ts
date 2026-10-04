import type { BackgroundEligibilityState } from "../translation/pageEligibility";
import type { BackgroundInspectionResult, BackgroundInspectionRevisions } from "./backgroundRemnantInspection";

/** Bump when inspection revision identity or output eligibility semantics change. */
export const BACKGROUND_REMNANT_INSPECTION_VERSION = 2;

export function revisionKeyOf(revisions: BackgroundInspectionRevisions): string | undefined {
  const { sourceRevision, backgroundRevision, removalRevision } = revisions;
  if (![sourceRevision, backgroundRevision, removalRevision].every((value) => typeof value === "string" && value.length > 0)) return undefined;
  const textRevision = revisions.textEvidenceRevision ?? JSON.stringify(["source-box-policy-v1", "", []]);
  return JSON.stringify([`background-remnant-inspection-v${BACKGROUND_REMNANT_INSPECTION_VERSION}`, sourceRevision, backgroundRevision, removalRevision, textRevision]);
}

export function backgroundEligibilityState(result: BackgroundInspectionResult): BackgroundEligibilityState {
  const open = result.candidates.some((candidate) => candidate.state !== "human-confirmed-artwork");
  if (open || result.truncated) return "unresolved";
  if (result.status === "unverified") return result.revisionKey && result.humanImageInspection?.revisionKey === result.revisionKey ? "human-confirmed" : "unavailable";
  return result.candidates.length > 0 ? "human-confirmed" : "approved";
}
