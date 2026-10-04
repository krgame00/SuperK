import {TARGET_LANGUAGES,LANGUAGE_POLICY_VERSION,resolveTargetLanguage} from '../languagePolicy';
import {createPageTargetIdentity,inspectPageOutputEligibility,type PageTargetIdentity,type BackgroundEligibilityState} from '../translation/pageEligibility';
import {hasContextualSourceEvidence,isReviewCurrent} from '../translation/qualityReview';
import {reviewTranslatedBubbles} from '../translation/qualityReviewClient';
import type {TranslatedBubble} from '../translationOverlay';
import {backgroundEligibilityState,revisionKeyOf} from '../cleaning/backgroundInspectionContract';
import type {BackgroundInspectionResult} from '../cleaning/backgroundRemnantInspection';
export {TARGET_LANGUAGES,LANGUAGE_POLICY_VERSION,resolveTargetLanguage,createPageTargetIdentity,reviewTranslatedBubbles};
export interface ExtensionEvidence {bubbles:TranslatedBubble[];targetIdentity?:PageTargetIdentity;sourceRevision?:string;backgroundEvidence?:BackgroundInspectionResult;backgroundState?:BackgroundEligibilityState;backgroundRevision?:string}
/** Raw renderer identity; do not trim/normalize before inspecting or reviewing. */
export function extensionDisplayedText(bubble: Pick<TranslatedBubble,'t'|'translated'>):string {
 return bubble.t || bubble.translated || '';
}
/** A background approval is usable only when the complete inspection is bound to these exact source and clean-image revisions. */
export function inspectBackgroundEvidence(value: ExtensionEvidence): {state?:BackgroundEligibilityState;revision?:string} {
 const proof=value?.backgroundEvidence;
 const sourceRevision=value?.sourceRevision;
 if(!proof||typeof proof!=='object'||!proof.revisions||typeof proof.revisions!=='object'||typeof proof.revisionKey!=='string'||!proof.revisionKey||proof.revisions.sourceRevision!==sourceRevision||typeof proof.revisions.removalRevision!=='string'||!proof.revisions.removalRevision||
   (proof.revisions.textEvidenceRevision!==undefined&&typeof proof.revisions.textEvidenceRevision!=='string')) return {};
 if(!/^[a-f0-9]{64}$/.test(proof.revisions.sourceRevision)||!/^[a-f0-9]{64}$/.test(proof.revisions.backgroundRevision)) return {};
 const revision=revisionKeyOf(proof.revisions);
 if(!revision||revision!==proof.revisionKey||!Array.isArray(proof.candidates)||!Number.isSafeInteger(proof.inspectedAreas)||proof.inspectedAreas<0) return {};
 if(proof.candidates.length>200||proof.candidates.some(candidate=>!candidate||typeof candidate.id!=='string'||!candidate.id||!['suspected-remnant','unchanged-candidate','uncertain','human-confirmed-artwork'].includes(candidate.state)||
   !['full-glyph','partial-glyph','unchanged','line-like'].includes(candidate.detail)||
   !candidate.rect||![candidate.rect.x,candidate.rect.y,candidate.rect.width,candidate.rect.height].every(number=>Number.isFinite(number)&&number>=0)||
   !Array.isArray(candidate.box)||candidate.box.length!==4||!candidate.box.every(number=>Number.isFinite(number)&&number>=0&&number<=1000)||
   !Number.isFinite(candidate.confidence)||candidate.confidence<0||candidate.confidence>1||
   !candidate.evidence||!Array.isArray(candidate.evidence.removalRegionIds)||!candidate.evidence.removalRegionIds.every(id=>typeof id==='string')||
   !Array.isArray(candidate.evidence.textEvidenceIds)||!candidate.evidence.textEvidenceIds.every(id=>typeof id==='string')||
   ![candidate.evidence.originalInkPixels,candidate.evidence.survivingInkPixels].every(number=>Number.isSafeInteger(number)&&number>=0)||
   ![candidate.evidence.meanLumaOriginal,candidate.evidence.meanLumaClean].every(number=>Number.isFinite(number)&&number>=0&&number<=255))) return {};
 const ids=new Set<string>();
 for(const candidate of proof.candidates){
  if(ids.has(candidate.id)) return {}; ids.add(candidate.id);
  if(candidate.state==='human-confirmed-artwork'&&(candidate.artworkConfirmation?.candidateId!==candidate.id||candidate.artworkConfirmation?.revisionKey!==proof.revisionKey)) return {};
  if(candidate.state!=='human-confirmed-artwork'&&candidate.artworkConfirmation) return {};
 }
 if(proof.truncated!==undefined&&typeof proof.truncated!=='boolean') return {};
 if(proof.status==='inspected'){
  if(proof.inspectedAreas===0||proof.unverifiedReason!==undefined||proof.unverifiedDetail!==undefined||proof.humanImageInspection!==undefined) return {};
 } else if(proof.status==='unverified'){
  if(!['missing-revisions','missing-original','missing-clean','dimension-mismatch','detection-failed','no-removal-evidence'].includes(proof.unverifiedReason??'')||proof.candidates.length!==0||proof.inspectedAreas!==0||
   (proof.unverifiedDetail!==undefined&&typeof proof.unverifiedDetail!=='string')||
   (proof.humanImageInspection!==undefined&&proof.humanImageInspection.revisionKey!==proof.revisionKey)) return {};
 } else return {};
 const state=backgroundEligibilityState(proof);
 if(value.backgroundState!==state||value.backgroundRevision!==proof.revisionKey) return {};
 return {state,revision:proof.revisionKey};
}
/** Exact evidence is recomputed at every reader/publication boundary. */
export function inspectExtensionOutput(value:ExtensionEvidence,_publication=false){
 void _publication; // Kept for API compatibility; all output paths now require both evidence sets.
 const valid=Array.isArray(value?.bubbles)&&value.bubbles.every(b=>b &&
   (b.t===undefined||typeof b.t==='string')&&(b.translated===undefined||typeof b.translated==='string')&&
   (b.original_text===undefined||typeof b.original_text==='string')&&
   (b.deleted===undefined||typeof b.deleted==='boolean')&&
   (!b.translationReview||(typeof b.translationReview==='object'&&typeof b.translationReview.sourceText==='string'&&typeof b.translationReview.reviewedText==='string'))&&
   Array.isArray(b.box)&&b.box.length===4&&b.box.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000));
 const bubbles=valid?value.bubbles:[];
 const targetIdentity=valid&&typeof value?.targetIdentity?.targetId==='string'&&typeof value.targetIdentity.policyVersion==='string'?value.targetIdentity:undefined;
 const sourceRevision=typeof value?.sourceRevision==='string'&&/^[a-f0-9]{64}$/.test(value.sourceRevision)?value.sourceRevision:undefined;
 const background=valid?inspectBackgroundEvidence(value):{};
 const contextualState=valid&&bubbles.filter(b=>!b.deleted).every(b=>hasContextualSourceEvidence(b,sourceRevision)&&!!sourceRevision&&b.translationReview?.policyVersion===LANGUAGE_POLICY_VERSION&&isReviewCurrent(b,targetIdentity?.targetId,sourceRevision)&&['ok','accepted','dismissed'].includes(b.translationReview?.status??''))?'approved':'unresolved';
 return inspectPageOutputEligibility({targetIdentity,sourceRevision,backgroundRevision:background.revision,backgroundState:background.state,contextualState,points:bubbles.map((b,i)=>({id:String(i),text:extensionDisplayedText(b),sourceText:b.original_text,deleted:b.deleted})),requirements:{contextual:true,background:true}});
}
export {buildQualityReviewPrompt} from '../translation/qualityReview';

export {sourceBytesFingerprint,originalSourceFingerprint} from './sourceFingerprint';
