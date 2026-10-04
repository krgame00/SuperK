import {describe,it,expect,vi} from 'vitest';
import {inspectExtensionOutput,createPageTargetIdentity,reviewTranslatedBubbles} from '@/lib/extension/strictParity';
import {withReviewIdentity} from '@/lib/translation/qualityReview';
const identity=createPageTargetIdentity('Thai')!;
const bubble=(t='ไทย')=>({t,box:[0,0,10,10],original_text:'source',translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:t},'th','pixels')});
describe('canonical extension evidence',()=>{
 it.each(['ไทยa','ไทยа','ไทย日本','ไทย𐐀','ไทยक','ไทยא','ไทยع','ไทยက','ไทย\u0301'])('never accepts rejected raw glyph %s',t=>expect(inspectExtensionOutput({bubbles:[bubble(t)],targetIdentity:identity,sourceRevision:'pixels'}).status).toBe('blocked'));
 it('permits current generated preview but requires background for publication',()=>{const e={bubbles:[bubble()],targetIdentity:identity,sourceRevision:'pixels'};expect(inspectExtensionOutput(e).status).toBe('eligible');expect(inspectExtensionOutput(e,true).status).toBe('blocked');});
 it('stale raw text, source and policy cannot reuse approval',()=>{for(const e of [{bubbles:[{...bubble(),t:'ไทย '}],sourceRevision:'pixels'},{bubbles:[bubble()],sourceRevision:'changed'},{bubbles:[bubble()],sourceRevision:'pixels',targetIdentity:{...identity,policyVersion:'old'}}])expect(inspectExtensionOutput({targetIdentity:identity,...e}).status).toBe('blocked');});
 it('one source-backed repair round resolves only affected point',async()=>{const fetchImpl=vi.fn(async(_url,init)=>{const body=JSON.parse(String(init?.body));return {ok:true,json:async()=>({reviews:body.items.map((i:{id:string})=>({id:i.id,status:body.mode?'suggested':'ok',...(body.mode?{suggestion:'ไทย'}:{})}))})} as Response;});const result=await reviewTranslatedBubbles([{t:'ไทยa',original_text:'source',box:[0,0,1,1]}],{targetLang:'th',sourceRevision:'pixels',repairContamination:true,fetchImpl});expect(result[0].t).toBe('ไทย');expect(fetchImpl).toHaveBeenCalledTimes(2);});
 it('missing and duplicate IDs stay unverified',async()=>{for(const reviews of [[],[{id:'0',status:'ok'},{id:'0',status:'ok'}]]){const result=await reviewTranslatedBubbles([bubble()],{targetLang:'th',sourceRevision:'pixels',fetchImpl:vi.fn(async()=>({ok:true,json:async()=>({reviews})}) as Response)});expect(inspectExtensionOutput({bubbles:result,targetIdentity:identity,sourceRevision:'pixels'}).status).toBe('blocked');}});
});

it('empty t never bypasses foreign translated fallback and malformed source cannot throw',()=>{
 const b={...bubble('ABC'),t:'',translated:'ABC'};expect(inspectExtensionOutput({bubbles:[b],targetIdentity:identity,sourceRevision:'pixels'}).status).toBe('blocked');
 for(const invalid of [{...bubble(),translated:42},{...bubble(),original_text:42},{...bubble(),t:42}])expect(inspectExtensionOutput({bubbles:[invalid as any],targetIdentity:identity,sourceRevision:'pixels'}).status).toBe('blocked');
});
