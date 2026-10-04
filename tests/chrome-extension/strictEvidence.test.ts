import {describe,it,expect,vi} from 'vitest';
import {inspectExtensionOutput,createPageTargetIdentity,reviewTranslatedBubbles} from '@/lib/extension/strictParity';
import {withReviewIdentity} from '@/lib/translation/qualityReview';
import {inspectedBackgroundEvidence} from '../helpers/extensionBackgroundEvidence';
const identity=createPageTargetIdentity('Thai')!;
const bubble=(t='ไทย')=>({t,box:[0,0,10,10],original_text:'source',translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:t},'th','a'.repeat(64))});
describe('canonical extension evidence',()=>{
 it.each(['ไทยa','ไทยа','ไทย日本','ไทย𐐀','ไทยक','ไทยא','ไทยع','ไทยက','ไทย\u0301'])('never accepts rejected raw glyph %s',t=>expect(inspectExtensionOutput({bubbles:[bubble(t)],targetIdentity:identity,sourceRevision:'a'.repeat(64)}).status).toBe('blocked'));
 it('requires current background inspection evidence for both display and publication',()=>{const sourceRevision='a'.repeat(64);const e={bubbles:[bubble()],targetIdentity:identity,sourceRevision};expect(inspectExtensionOutput(e).status).toBe('blocked');const reviewed={...e,...inspectedBackgroundEvidence(sourceRevision)};expect(inspectExtensionOutput(reviewed).status).toBe('eligible');expect(inspectExtensionOutput(reviewed,true).status).toBe('eligible');});
 it('rejects background proof reused for another source or altered clean revision',()=>{const sourceRevision='a'.repeat(64);const e={bubbles:[bubble()],targetIdentity:identity,sourceRevision,...inspectedBackgroundEvidence(sourceRevision)};expect(inspectExtensionOutput({...e,sourceRevision:'b'.repeat(64)}).status).toBe('blocked');expect(inspectExtensionOutput({...e,backgroundRevision:'different'}).status).toBe('blocked');expect(inspectExtensionOutput({...e,backgroundEvidence:{...e.backgroundEvidence,revisionKey:'forged'}}).status).toBe('blocked');});
 it('stale raw text, source and policy cannot reuse approval',()=>{for(const e of [{bubbles:[{...bubble(),t:'ไทย '}],sourceRevision:'a'.repeat(64)},{bubbles:[bubble()],sourceRevision:'changed'},{bubbles:[bubble()],sourceRevision:'a'.repeat(64),targetIdentity:{...identity,policyVersion:'old'}}])expect(inspectExtensionOutput({targetIdentity:identity,...e}).status).toBe('blocked');});
 it('allows an explicitly human reviewed handwritten point only for its exact source pixels and box',()=>{
  const sourceRevision='c'.repeat(64),box=[10,20,90,120],t='ไทย';
  const point={t,box,translationReview:withReviewIdentity({status:'accepted',sourceText:'',reviewedText:t,sourceEvidenceKind:'image',humanVerified:true,sourceBox:box},'th',sourceRevision)};
  const evidence={targetIdentity:identity,sourceRevision,...inspectedBackgroundEvidence(sourceRevision)};
  expect(inspectExtensionOutput({bubbles:[point],...evidence}).status).toBe('eligible');
  expect(inspectExtensionOutput({bubbles:[{...point,box:[10,20,91,120]}],...evidence}).status).toBe('blocked');
  expect(inspectExtensionOutput({bubbles:[{...point,translationReview:{...point.translationReview,humanVerified:false}}],...evidence}).status).toBe('blocked');
 });
 it('one source-backed repair round resolves only affected point',async()=>{const fetchImpl=vi.fn(async(_url,init)=>{const body=JSON.parse(String(init?.body));return {ok:true,json:async()=>({reviews:body.items.map((i:{id:string})=>({id:i.id,status:body.mode?'suggested':'ok',...(body.mode?{suggestion:'ไทย'}:{})}))})} as Response;});const result=await reviewTranslatedBubbles([{t:'ไทยa',original_text:'source',box:[0,0,1,1]}],{targetLang:'th',sourceRevision:'a'.repeat(64),repairContamination:true,fetchImpl});expect(result[0].t).toBe('ไทย');expect(fetchImpl).toHaveBeenCalledTimes(2);});
 it('missing and duplicate IDs stay unverified',async()=>{for(const reviews of [[],[{id:'0',status:'ok'},{id:'0',status:'ok'}]]){const result=await reviewTranslatedBubbles([bubble()],{targetLang:'th',sourceRevision:'a'.repeat(64),fetchImpl:vi.fn(async()=>({ok:true,json:async()=>({reviews})}) as Response)});expect(inspectExtensionOutput({bubbles:result,targetIdentity:identity,sourceRevision:'a'.repeat(64)}).status).toBe('blocked');}});
});

it('empty t never bypasses foreign translated fallback and malformed source cannot throw',()=>{
 const b={...bubble('ABC'),t:'',translated:'ABC'};expect(inspectExtensionOutput({bubbles:[b],targetIdentity:identity,sourceRevision:'a'.repeat(64)}).status).toBe('blocked');
 for(const invalid of [{...bubble(),translated:42},{...bubble(),original_text:42},{...bubble(),t:42}])expect(inspectExtensionOutput({bubbles:[invalid as any],targetIdentity:identity,sourceRevision:'a'.repeat(64)}).status).toBe('blocked');
});
