import {TARGET_LANGUAGES,LANGUAGE_POLICY_VERSION,resolveTargetLanguage} from '../languagePolicy';
import {createPageTargetIdentity,inspectPageOutputEligibility,type PageTargetIdentity,type BackgroundEligibilityState} from '../translation/pageEligibility';
import {isReviewCurrent} from '../translation/qualityReview';
import {reviewTranslatedBubbles} from '../translation/qualityReviewClient';
import type {TranslatedBubble} from '../translationOverlay';
export {TARGET_LANGUAGES,LANGUAGE_POLICY_VERSION,resolveTargetLanguage,createPageTargetIdentity,reviewTranslatedBubbles};
export interface ExtensionEvidence {bubbles:TranslatedBubble[];targetIdentity?:PageTargetIdentity;sourceRevision?:string;backgroundState?:BackgroundEligibilityState;backgroundRevision?:string}
/** Raw renderer identity; do not trim/normalize before inspecting or reviewing. */
export function extensionDisplayedText(bubble: Pick<TranslatedBubble,'t'|'translated'>):string {
 return bubble.t || bubble.translated || '';
}
/** Exact evidence is recomputed at every reader/publication boundary. */
export function inspectExtensionOutput(value:ExtensionEvidence,publication=false){
 const valid=Array.isArray(value?.bubbles)&&value.bubbles.every(b=>b &&
   (b.t===undefined||typeof b.t==='string')&&(b.translated===undefined||typeof b.translated==='string')&&
   (b.original_text===undefined||typeof b.original_text==='string')&&
   (b.deleted===undefined||typeof b.deleted==='boolean')&&
   (!b.translationReview||(typeof b.translationReview==='object'&&typeof b.translationReview.sourceText==='string'&&typeof b.translationReview.reviewedText==='string'))&&
   Array.isArray(b.box)&&b.box.length===4&&b.box.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000));
 const bubbles=valid?value.bubbles:[];
 const targetIdentity=valid&&typeof value?.targetIdentity?.targetId==='string'&&typeof value.targetIdentity.policyVersion==='string'?value.targetIdentity:undefined;
 const sourceRevision=typeof value?.sourceRevision==='string'?value.sourceRevision:undefined;
 const contextualState=valid&&bubbles.filter(b=>!b.deleted).every(b=>!!b.original_text?.trim()&&!!sourceRevision&&b.translationReview?.policyVersion===LANGUAGE_POLICY_VERSION&&isReviewCurrent(b,targetIdentity?.targetId,sourceRevision)&&['ok','accepted','dismissed'].includes(b.translationReview?.status??''))?'approved':'unresolved';
 return inspectPageOutputEligibility({targetIdentity,sourceRevision,backgroundRevision:value?.backgroundRevision,backgroundState:value?.backgroundState,contextualState,points:bubbles.map((b,i)=>({id:String(i),text:extensionDisplayedText(b),sourceText:b.original_text,deleted:b.deleted})),requirements:{contextual:true,background:publication}});
}
export {buildQualityReviewPrompt} from '../translation/qualityReview';

export {sourceBytesFingerprint,originalSourceFingerprint} from './sourceFingerprint';
