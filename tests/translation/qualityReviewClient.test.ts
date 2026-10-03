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
  it("does not guess missing source or review manual/deleted bubbles",async()=>{
    const fetchImpl=vi.fn();
    const manual={...bubble,isManual:true}; const deleted={...bubble,deleted:true};
    const result=await reviewTranslatedBubbles([{t:"สวัสดี"},manual,deleted],{targetLang:"Thai",fetchImpl});
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result[0].translationReview?.status).toBe("unavailable");
    expect(result[1]).toBe(manual); expect(result[2]).toBe(deleted);
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
  it("flags excess items rather than silently approving them",async()=>{
    const fetchImpl=vi.fn().mockResolvedValue(Response.json({reviews:Array.from({length:64},(_,i)=>({id:String(i),status:"ok"}))}));
    const result=await reviewTranslatedBubbles(Array.from({length:65},()=>({...bubble})),{targetLang:"Thai",fetchImpl});
    expect(result[63].translationReview?.status).toBe("ok");
    expect(result[64].translationReview?.status).toBe("unavailable");
  });
});
