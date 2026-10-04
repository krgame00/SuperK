import {describe,it,expect,vi} from "vitest";
import {reviewTranslatedBubbles} from "@/lib/translation/qualityReviewClient";

describe("page quality review client", () => {
  const bubble={t:"รอตรงนี้นะ",original_text:"Wait here.",box:[0,0,100,100]};
  it.each([false,true])("flags mixed text locally even when source/provider is unavailable: %s",async withSource=>{
    const mixed={...bubble,t:"กลิ่นนี่มันมีมนמהขลังอะไรกันแน่...",original_text:withSource?bubble.original_text:""};
    const result=await reviewTranslatedBubbles([mixed],{targetLang:"Thai",fetchImpl:vi.fn().mockRejectedValue(new Error("offline"))});
    expect(result[0]).toMatchObject({...mixed,translationReview:{status:"needs_review",reason:expect.stringContaining("מה")}});
  });
  it("allows Hebrew when translating into Hebrew",async()=>{
    const mixed={...bubble,t:"שלום"};
    const result=await reviewTranslatedBubbles([mixed],{targetLang:"Hebrew",fetchImpl:vi.fn().mockResolvedValue(Response.json({reviews:[{id:"0",status:"ok"}]}))});
    expect(result[0].translationReview?.status).toBe("ok");
  });
  it("reviews before rendering without replacing text or geometry", async () => {
    const fetchImpl=vi.fn().mockResolvedValue(Response.json({reviews:[{id:"0",status:"suggested",suggestion:"รอที่นี่นะ"}]}));
    const result=await reviewTranslatedBubbles([bubble],{targetLang:"Thai",fetchImpl});
    expect(result[0]).toMatchObject({...bubble,translationReview:{status:"suggested",suggestion:"รอที่นี่นะ"}});
    expect(bubble).not.toHaveProperty("translationReview");
  });
  it("preserves translations when the provider fails",async()=>{
    const result=await reviewTranslatedBubbles([bubble],{targetLang:"Thai",fetchImpl:vi.fn().mockRejectedValue(new Error("offline"))});
    expect(result[0]).toMatchObject({...bubble,translationReview:{status:"unavailable"}});
  });
  it("reviews manual points, never guesses without source, and excludes deleted points",async()=>{
    const fetchImpl=vi.fn(async(_url,init)=>{const body=JSON.parse(String(init?.body));return Response.json({reviews:body.items.map((item:{id:string})=>({id:item.id,status:"ok"}))});});
    const manual={...bubble,isManual:true}; const deleted={...bubble,deleted:true};
    const result=await reviewTranslatedBubbles([{t:"สวัสดี"},manual,deleted],{targetLang:"Thai",fetchImpl});
    const sent=JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).items as Array<{id:string}>;
    expect(sent.map(item=>item.id)).toEqual(["1"]);
    expect(result[0].translationReview?.status).toBe("unavailable");
    expect(result[0].t).toBe("สวัสดี");
    expect(result[1].translationReview?.status).toBe("ok");
    expect(result[1].isManual).toBe(true);
    expect(result[2]).toBe(deleted);
  });
  it("propagates cancellation instead of caching a completed page",async()=>{
    const controller=new AbortController(); controller.abort();
    await expect(reviewTranslatedBubbles([bubble],{targetLang:"Thai",signal:controller.signal,fetchImpl:vi.fn()})).rejects.toMatchObject({name:"AbortError"});
  });
  it("still propagates cancellation when fetch returns an error response",async()=>{
    const controller=new AbortController();
    const fetchImpl=vi.fn().mockImplementation(async()=>{controller.abort();return new Response(null,{status:499});});
    await expect(reviewTranslatedBubbles([bubble],{targetLang:"Thai",signal:controller.signal,fetchImpl})).rejects.toMatchObject({name:"AbortError"});
  });
  it("flags malformed source metadata without failing successful translation",async()=>{
    const fetchImpl=vi.fn();
    const result=await reviewTranslatedBubbles([{...bubble,original_text:42} as unknown as typeof bubble],{targetLang:"Thai",fetchImpl});
    expect(result[0].t).toBe(bubble.t);
    expect(result[0].translationReview?.status).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("chunks dense pages across requests instead of leaving points unreviewed",async()=>{
    const fetchImpl=vi.fn(async(_url,init)=>{const body=JSON.parse(String(init?.body));return Response.json({reviews:body.items.map((item:{id:string})=>({id:item.id,status:"ok"}))});});
    const result=await reviewTranslatedBubbles(Array.from({length:65},()=>({...bubble})),{targetLang:"Thai",fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result[63].translationReview?.status).toBe("ok");
    expect(result[64].translationReview?.status).toBe("ok");
  });
});
