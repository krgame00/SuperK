import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useTranslation } from "@/hooks/useTranslation";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
import { saveProjectSession, loadProjectSession } from "@/lib/projectStore";
import { createPageTargetIdentity, type PageTargetIdentity } from "@/lib/translation/pageEligibility";

vi.mock("@/lib/colorMatching/canvasSampler", async original => ({...await original<typeof import("@/lib/colorMatching/canvasSampler")>(),sampleBubbleRegion:vi.fn(()=>null)}));
vi.mock("@/lib/translationOverlay",()=>({applyTranslationOverlay:vi.fn(async (_b:unknown,_v:unknown,_p:unknown,_m:unknown,done?: (url:string)=>void)=>done?.("data:render"))}));
vi.mock("@/lib/projectStore",()=>({saveProjectSession:vi.fn().mockResolvedValue(undefined),loadProjectSession:vi.fn().mockResolvedValue(null),clearProjectSession:vi.fn().mockResolvedValue(undefined),deleteAsset:vi.fn().mockResolvedValue(undefined)}));
beforeEach(()=>{
  vi.clearAllMocks();
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:storage});
  Object.defineProperty(window,"localStorage",{configurable:true,value:storage});
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
const pages=["blob:original"];
const options={currentPage:0,pages,viewMode:"single" as const,preparePageForTranslation:async()=>({recognitionUrl:pages[0],backgroundUrl:"blob:clean"})};
function mockTranslation(text:string) {
  return vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    if(String(input)===pages[0])return new Response(new Blob(["original"],{type:"image/png"}));
    if(String(input)==="/api/translate")return Response.json({text:JSON.stringify({bubbles:[{box:[10,20,40,80],t:text}]})});
    throw new Error(`Unexpected request ${String(input)}`);
  });
}
function targets(value:ReturnType<typeof useTranslation>) {
  return (value as ReturnType<typeof useTranslation> & {pageTargetCacheRef?:{current:Map<string,PageTargetIdentity>}}).pageTargetCacheRef?.current;
}
test("captures page identity at actual job start and preserves it when next-job selector changes",async()=>{
  mockTranslation("Bonjour");
  const {result}=renderHook(()=>useTranslation(options));
  act(()=>result.current.setTargetLang("French"));
  await act(async()=>{expect(await result.current.handleTranslate()).toBe(true);});
  expect(targets(result.current)?.get(pages[0])).toEqual(createPageTargetIdentity("fr"));
  const before=result.current.bubbleCacheRef.current.get(pages[0]);
  vi.mocked(applyTranslationOverlay).mockClear();
  act(()=>result.current.setTargetLang("Japanese"));
  expect(targets(result.current)?.get(pages[0])?.targetId).toBe("fr");
  expect(result.current.bubbleCacheRef.current.get(pages[0])).toBe(before);
  for(const call of vi.mocked(applyTranslationOverlay).mock.calls)expect(call[9]).toBe("fr");
  await act(async()=>{await result.current.retrySaveSession();});
  expect(vi.mocked(saveProjectSession).mock.calls.at(-1)?.[0].pageTargetCache?.get(pages[0])?.targetId).toBe("fr");
});
test.each([["Thai","A: สวัสดี"],["Persian","می‌خواهم\nسلام"]])("retains raw excluded prefixes and native marks for %s",async(target,text)=>{
  mockTranslation(text);
  const {result}=renderHook(()=>useTranslation(options));
  act(()=>{result.current.setTargetLang(target);});
  await act(async()=>{expect(await result.current.handleTranslate()).toBe(true);});
  expect(result.current.bubbleCacheRef.current.get(pages[0])?.[0].t).toBe(text);
});
test("failed retranslation preserves the surviving page result and its target",async()=>{
  const fetch=mockTranslation("Bonjour");
  const {result}=renderHook(()=>useTranslation(options));
  act(()=>result.current.setTargetLang("French"));
  await act(async()=>{await result.current.handleTranslate();});
  const before=result.current.bubbleCacheRef.current.get(pages[0]);
  act(()=>result.current.setTargetLang("Japanese"));
  fetch.mockImplementation(async input=>String(input)===pages[0]?new Response(new Blob(["original"])):Response.json({error:"failed"},{status:500}));
  await act(async()=>{expect(await result.current.handleTranslate()).toBe(false);});
  expect(result.current.bubbleCacheRef.current.get(pages[0])).toBe(before);
  expect(targets(result.current)?.get(pages[0])?.targetId).toBe("fr");
});
test("restores recorded targets and keeps legacy missing targets unconfirmed",async()=>{
  vi.mocked(loadProjectSession).mockResolvedValue({pages:[{id:"stable",url:pages[0],name:"page"}],currentPage:0,updatedAt:1,hasUnrecoverableSources:false,bubbleCache:new Map(),translatedImageCache:new Map(),pageTargetCache:new Map([[pages[0],createPageTargetIdentity("ja")!]])});
  const {result}=renderHook(()=>useTranslation(options));
  await act(async()=>{await result.current.restoreSavedSession();});
  expect(targets(result.current)?.get(pages[0])?.targetId).toBe("ja");
  vi.mocked(loadProjectSession).mockResolvedValue({pages:[{id:"stable",url:pages[0],name:"page"}],currentPage:0,updatedAt:1,hasUnrecoverableSources:false,bubbleCache:new Map(),translatedImageCache:new Map(),pageTargetCache:new Map()});
  await act(async()=>{await result.current.restoreSavedSession();});
  expect(targets(result.current)?.has(pages[0])).toBe(false);
});
test("crop translation cannot relabel existing points with the next-job target",async()=>{
  const fetch=mockTranslation("Bonjour");
  const {result}=renderHook(()=>useTranslation(options));
  act(()=>result.current.setTargetLang("French"));
  await act(async()=>{await result.current.handleTranslate();});
  const previous=result.current.bubbleCacheRef.current.get(pages[0]);
  const calls=fetch.mock.calls.length;
  act(()=>result.current.setTargetLang("Japanese"));
  await act(async()=>{await result.current.translateCrop({x:0,y:0,w:100,h:100},"crop",1000,1000);});
  expect(fetch.mock.calls.length).toBe(calls);
  expect(result.current.bubbleCacheRef.current.get(pages[0])).toBe(previous);
  expect(result.current.translationResult).toContain("แปลทั้งหน้า");
});
test("changing next-job target while cleaning cannot change the active translation target",async()=>{
  const fetch=mockTranslation("Bonjour");
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const {result}=renderHook(()=>useTranslation({...options,preparePageForTranslation:async()=>{await gate;return {recognitionUrl:pages[0],backgroundUrl:"blob:clean"};}}));
  act(()=>result.current.setTargetLang("French"));
  let job!:Promise<boolean>;
  act(()=>{job=result.current.handleTranslate();});
  act(()=>result.current.setTargetLang("Japanese"));
  await act(async()=>{release();expect(await job).toBe(true);});
  const request=fetch.mock.calls.find(call=>String(call[0])==="/api/translate");
  expect(JSON.parse(String(request?.[1]?.body)).targetLang).toBe("fr");
  expect(targets(result.current)?.get(pages[0])?.targetId).toBe("fr");
});
test("restored obsolete policy cannot render lettering as if currently verified",async()=>{
  vi.mocked(loadProjectSession).mockResolvedValue({pages:[{id:"stable",url:pages[0],name:"page"}],currentPage:0,updatedAt:1,hasUnrecoverableSources:false,bubbleCache:new Map([[pages[0],[{t:"Bonjour",box:[10,20,40,80]}]]]),translatedImageCache:new Map(),pageTargetCache:new Map([[pages[0],{targetId:"fr",policyVersion:"obsolete"}]])});
  const {result}=renderHook(()=>useTranslation(options));
  await act(async()=>{await result.current.restoreSavedSession();});
  vi.mocked(applyTranslationOverlay).mockClear();
  await act(async()=>{await result.current.refreshPageTranslation(pages[0],"blob:clean");});
  for(const call of vi.mocked(applyTranslationOverlay).mock.calls)expect(call[9]).toBeUndefined();
});
test.each(["กAา","เลข ١٢"])("restored baked bitmap cannot leak excluded lettering or unnormalized numeral forms: %s",async text=>{
  vi.mocked(loadProjectSession).mockResolvedValue({pages:[{id:"stable",url:pages[0],name:"page"}],currentPage:0,updatedAt:1,hasUnrecoverableSources:false,bubbleCache:new Map([[pages[0],[{t:text,box:[10,20,40,80]}]]]),translatedImageCache:new Map([[pages[0],"data:unsafe-bitmap"]]),pageTargetCache:new Map([[pages[0],createPageTargetIdentity("th")!]])});
  const {result}=renderHook(()=>useTranslation({...options,viewMode:"scroll"}));
  await act(async()=>{await result.current.restoreSavedSession();});
  expect(result.current.translatedImages.has(pages[0])).toBe(false);
  expect(result.current.translatedImageCacheRef.current.has(pages[0])).toBe(false);
  expect(result.current.bubbleCacheRef.current.get(pages[0])?.[0].t).toBe(text);
});

