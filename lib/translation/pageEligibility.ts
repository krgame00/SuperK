import { LANGUAGE_POLICY_VERSION, inspectTargetText, resolveTargetLanguage, type TargetTextInspection } from "../languagePolicy";

export interface PageTargetIdentity { targetId:string; policyVersion:string }
export interface EligibilityPoint { id:string; text:string; sourceText?:string; deleted?:boolean }
export type ContextualEligibilityState = "approved" | "human-confirmed" | "unavailable" | "unresolved";
export type BackgroundEligibilityState = "approved" | "human-confirmed" | "unavailable" | "unresolved";
export type PageBlockingReason = "target-unconfirmed" | "unsupported-target" | "policy-changed" | "script-violation" | "contextual-review-required" | "background-review-required";
export interface PageEligibilityInput {
  targetIdentity?:PageTargetIdentity;
  points:readonly EligibilityPoint[];
  sourceRevision?:string;
  backgroundRevision?:string;
  contextualState?:ContextualEligibilityState;
  backgroundState?:BackgroundEligibilityState;
  /** Preview-only scopes are explicit. Export/publication must require both checks. */
  requirements?:{contextual:boolean;background:boolean};
}
export interface PageOutputEligibility {
  status:"eligible"|"blocked";
  scriptStatus:"eligible"|"blocked";
  targetIdentity?:PageTargetIdentity;
  policyVersion:string;
  /** Exact local evidence identity, intentionally not a collision-prone approval hash. */
  revisionKey:string;
  reasons:PageBlockingReason[];
  pointIssues:(TargetTextInspection & {pointId:string})[];
}
export function createPageTargetIdentity(target:string):PageTargetIdentity|undefined {
  const resolution=resolveTargetLanguage(target);
  return resolution.status==="resolved" ? {targetId:resolution.profile.id,policyVersion:LANGUAGE_POLICY_VERSION}:undefined;
}
/** Recompute at each output boundary. Existing approvals never bypass this local result. */
export function inspectPageOutputEligibility(input:PageEligibilityInput):PageOutputEligibility {
  const {targetIdentity}=input;
  const points=input.points.filter(point=>!point.deleted);
  const reasons:PageBlockingReason[]=[];
  if(!targetIdentity)reasons.push("target-unconfirmed");
  else {
    if(resolveTargetLanguage(targetIdentity.targetId).status!=="resolved")reasons.push("unsupported-target");
    if(targetIdentity.policyVersion!==LANGUAGE_POLICY_VERSION)reasons.push("policy-changed");
  }
  const pointIssues=targetIdentity ? points.map(point=>({...inspectTargetText(point.text,targetIdentity.targetId),pointId:point.id})).filter(point=>point.status==="blocked"):[];
  if(pointIssues.some(point=>point.reason==="excluded-script"))reasons.push("script-violation");
  const scriptStatus=reasons.length ? "blocked":"eligible";
  if(input.contextualState==="unavailable"||input.contextualState==="unresolved"||(!input.contextualState&&(input.requirements?.contextual??true)))reasons.push("contextual-review-required");
  if(input.backgroundState==="unavailable"||input.backgroundState==="unresolved"||(!input.backgroundState&&(input.requirements?.background??true)))reasons.push("background-review-required");
  return {
    status:reasons.length ? "blocked":"eligible",scriptStatus,targetIdentity,policyVersion:LANGUAGE_POLICY_VERSION,
    revisionKey:JSON.stringify([targetIdentity??null,LANGUAGE_POLICY_VERSION,input.sourceRevision??null,input.backgroundRevision??null,points.map(point=>[point.id,point.text,point.sourceText??null])]),
    reasons,pointIssues,
  };
}
