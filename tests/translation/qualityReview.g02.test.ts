import {describe,it,expect,vi} from "vitest";
import {reviewTranslatedBubbles} from "@/lib/translation/qualityReviewClient";
import {isReviewCurrent,parseQualityReviews} from "@/lib/translation/qualityReview";
const bubble={t:"รอ",original_text:" Wait. ",box:[1,2,3,4],fontSize:24};
interface ReviewBody{mode?:string;items:Array<{id:string;sourceText:string;translatedText:string}>}
const echoBody=(init:RequestInit|undefined)=>JSON.parse(String(init?.body)) as ReviewBody;
describe("G02 exact contextual review and bounded repair",()=>{
 it("reviews every active point across bounded chunks including manual",async()=>{
  const fetchImpl=vi.fn(async(_url,init)=>{const body=echoBody(init);return Response.json({reviews:body.items.map((item:{id:string})=>({id:item.id,status:"ok"}))});});
  const result=await reviewTranslatedBubbles(Array.from({length:130},()=>({...bubble,isManual:true})),{targetLang:"th",fetchImpl});
  expect(fetchImpl).toHaveBeenCalledTimes(3); expect(result.every(b=>b.translationReview?.status==="ok")).toBe(true);
 });
 it("binds exact raw snapshots to target and source revision",async()=>{
  const fetchImpl=vi.fn(async()=>Response.json({reviews:[{id:"0",status:"ok"}]}));
  const result=await reviewTranslatedBubbles([{...bubble,t:" รอ "}],{targetLang:"th",sourceRevision:"source-1",fetchImpl});
  expect(result[0].translationReview).toMatchObject({sourceText:" Wait. ",reviewedText:" รอ ",targetId:"th",sourceRevision:"source-1",policyVersion:expect.any(String)});
  expect(isReviewCurrent({...result[0],t:"รอ"})).toBe(false);
  expect(isReviewCurrent(result[0],"en","source-1")).toBe(false);
  expect(isReviewCurrent(result[0],"th","source-2")).toBe(false);
 });
 it("repairs only contaminated points once and keeps editorial suggestions explicit",async()=>{
  const fetchImpl=vi.fn(async(_url,init)=>{const body=echoBody(init);return Response.json({reviews:body.items.map((item:{id:string})=>({id:item.id,status:"suggested",suggestion:body.mode==="repair"?"สวัสดี":"รอตรงนี้"}))});});
  const result=await reviewTranslatedBubbles([{...bubble,t:"สวัสดีA"},bubble],{targetLang:"th",repairContamination:true,fetchImpl});
  expect(fetchImpl).toHaveBeenCalledTimes(2); expect(echoBody(fetchImpl.mock.calls[1][1]).items.map((i:{id:string})=>i.id)).toEqual(["0"]);
  expect(result[0]).toMatchObject({...bubble,t:"สวัสดี",box:[1,2,3,4],fontSize:24,translationReview:{status:"ok",originalTranslation:"สวัสดีA"}});
  expect(result[1].t).toBe(bubble.t); expect(result[1].translationReview?.status).toBe("suggested");
 });
 it("does not guess without source and rejects contaminated repair with no loop",async()=>{
  const fetchImpl=vi.fn(async()=>Response.json({reviews:[{id:"0",status:"suggested",suggestion:"รอA"}]}));
  const result=await reviewTranslatedBubbles([{...bubble,t:"รอA"},{...bubble,t:"รอB",original_text:""}],{targetLang:"th",repairContamination:true,fetchImpl});
  expect(fetchImpl).toHaveBeenCalledTimes(2);expect(result[0].t).toBe("รอA");expect(result[1].t).toBe("รอB");expect(result.every(b=>b.translationReview?.status==="needs_review")).toBe(true);
 });
 it("does not approve source-less provider approval",()=>{
  expect(parseQualityReviews([{id:"0",sourceText:"",translatedText:"รอ"}],{reviews:[{id:"0",status:"ok"}]},"th")["0"].status).toBe("unavailable");
 });
 it("keeps the unresolved snapshot when repair rows are missing or duplicated",async()=>{
  const fetchImpl=vi.fn(async(_url,init)=>{const body=echoBody(init);
   if(body.mode==="repair")return Response.json({reviews:[{id:"0",status:"ok"},{id:"0",status:"suggested",suggestion:"สวัสดี"}]});
   return Response.json({reviews:body.items.map((item:{id:string})=>({id:item.id,status:"ok"}))});});
  const result=await reviewTranslatedBubbles([{...bubble,t:"สวัสดีA"}],{targetLang:"th",repairContamination:true,fetchImpl});
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result[0].t).toBe("สวัสดีA");
  expect(result[0].translationReview?.status).toBe("needs_review");
 });
 it("chunks repair requests for dense pages beyond the request limit",async()=>{
  const contaminated=Array.from({length:130},()=>({...bubble,t:"สวัสดีA"}));
  const fetchImpl=vi.fn(async(_url,init)=>{const body=echoBody(init);
   return Response.json({reviews:body.items.map((item:{id:string})=>({id:item.id,status:"suggested",suggestion:body.mode==="repair"?"สวัสดี":"สวัสดีA"}))});});
  const result=await reviewTranslatedBubbles(contaminated,{targetLang:"th",repairContamination:true,fetchImpl});
  expect(fetchImpl).toHaveBeenCalledTimes(6);
  const repairBodies=fetchImpl.mock.calls.map(call=>echoBody(call[1])).filter(body=>body.mode==="repair");
  expect(repairBodies.map(body=>body.items.length)).toEqual([64,64,2]);
  expect(result.every(b=>b.t==="สวัสดี"&&b.translationReview?.status==="ok")).toBe(true);
 });
 it("exposes explicit unverified snapshots for points beyond request text limits",async()=>{
  const fetchImpl=vi.fn(async(_url,init)=>{const body=echoBody(init);return Response.json({reviews:body.items.map((item:{id:string})=>({id:item.id,status:"ok"}))});});
  const oversized={...bubble,t:"ก".repeat(2001)};
  const result=await reviewTranslatedBubbles([bubble,oversized],{targetLang:"th",fetchImpl});
  expect(echoBody(fetchImpl.mock.calls[0][1]).items.map((item:{id:string})=>item.id)).toEqual(["0"]);
  expect(result[1].translationReview?.status).toBe("unavailable");
  expect(result[1].t).toHaveLength(2001);
 });
 it("propagates cancellation instead of starting the repair round",async()=>{
  const controller=new AbortController();
  const fetchImpl=vi.fn(async()=>{controller.abort();return Response.json({reviews:[{id:"0",status:"ok"}]});});
  await expect(reviewTranslatedBubbles([{...bubble,t:"สวัสดีA"}],{targetLang:"th",repairContamination:true,signal:controller.signal,fetchImpl})).rejects.toMatchObject({name:"AbortError"});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it("keeps the failed repair unresolved when the repair request itself fails",async()=>{
  let calls=0;
  const fetchImpl=vi.fn(async(_url,init)=>{const body=echoBody(init);
   if(body.mode==="repair")throw new Error("network down");
   calls+=1;return Response.json({reviews:body.items.map((item:{id:string})=>({id:item.id,status:"ok"}))});});
  const result=await reviewTranslatedBubbles([{...bubble,t:"สวัสดีA"}],{targetLang:"th",repairContamination:true,fetchImpl});
  expect(calls).toBe(1);
  expect(result[0].t).toBe("สวัสดีA");
  expect(result[0].translationReview?.status).toBe("needs_review");
 });
});
