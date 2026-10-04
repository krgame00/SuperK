import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { applyTranslationOverlay, type TranslatedBubble } from "@/lib/translationOverlay";
import { undoManager } from "@/lib/undoManager";
vi.mock("@/lib/colorMatching/canvasSampler",()=>({sampleBubbleRegion:()=>null,sampleRectRegion:()=>null}));
let ink:string[];
beforeEach(()=>{
  vi.useFakeTimers();undoManager.clear();ink=[];
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
  document.body.innerHTML='<div id="pageContainer"><img /></div>';
  Object.defineProperties(document.querySelector("img")!,{naturalWidth:{value:1000},naturalHeight:{value:1000},complete:{value:true}});
  Object.defineProperty(document,"fonts",{configurable:true,value:{load:vi.fn().mockResolvedValue([{}]),check:()=>true}});
  const ctx={font:"",measureText:(text:string)=>({width:text.length*5}),fillText:(text:string)=>ink.push(text),strokeText:(text:string)=>ink.push(text),getImageData:()=>({data:new Uint8ClampedArray(4)})};
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(new Proxy(ctx,{get:(obj,key)=>key in obj?obj[key as keyof typeof obj]:vi.fn()}) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,"toDataURL").mockReturnValue("data:render");
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
async function paint(bubbles:TranslatedBubble[],target?:string) {
  await applyTranslationOverlay(bubbles,"single",0,()=>{},undefined,{current:{fontFamily:"sans-serif",fontSizeMultiplier:1}},undefined,undefined,undefined,target);
  await vi.advanceTimersByTimeAsync(250);
}
test("withholds only excluded lettering while preserving editable selection and offending characters",async()=>{
  const bad:TranslatedBubble={t:"กA𐐀า",box:[100,100,300,400],translationReview:{status:"accepted",sourceText:"Hello",reviewedText:"กA𐐀า"}};
  await paint([bad,{t:"สวัสดี",box:[400,100,600,400]}],"th");
  expect(ink.join("")).not.toContain("A");
  expect(ink.join("")).not.toContain("𐐀");
  expect(ink.join("")).toContain("สวัสดี");
  const blocked=document.querySelector<HTMLElement>('[data-script-status="blocked"]')!;
  expect(blocked).not.toBeNull();
  expect(blocked.getAttribute("title")).toContain("A");
  expect(blocked.getAttribute("title")).toContain("𐐀");
  expect(blocked.querySelector(".bubble-text-selection")).not.toBeNull();
  blocked.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
  expect(document.querySelector<HTMLTextAreaElement>('[data-translation-editor] textarea')?.value).toBe(bad.t);
});
test.each([undefined,"unknown","Chinese"])("withholds lettering for unresolved target %s",async target=>{
  await paint([{t:"Hello",box:[100,100,300,400]}],target);
  expect(ink).toEqual([]);
  expect(document.querySelector('[data-script-status="blocked"] .bubble-text-selection')).not.toBeNull();
});
test("renders a supported target with native lettering",async()=>{
  await paint([{t:"Bonjour",box:[100,100,300,400]}],"fr");
  expect(ink.join("")).toContain("Bonjour");
});
test("shows code points for invisible or unverifiable excluded characters",async()=>{
  await paint([{t:"ก\uE000\u0001\u0301",box:[100,100,300,400]}],"th");
  const title=document.querySelector<HTMLElement>('[data-script-status="blocked"]')?.title;
  expect(title).toContain("U+E000");
  expect(title).toContain("U+0001");
  expect(title).toContain("U+0301");
  expect(ink).toEqual([]);
});
test.each(["\u000Bสวัสดี", "สวัสดี\u000B", "\u000Cสวัสดี", "สวัสดี\u000C"])("inspects stored edge controls before layout trimming: %j",async text=>{
  const bubble:TranslatedBubble={t:text,box:[100,100,300,400],translationReview:{status:"accepted",sourceText:"Hello",reviewedText:text.trim()}};
  await paint([bubble],"th");
  expect(ink).toEqual([]);
  const blocked=document.querySelector<HTMLElement>('[data-script-status="blocked"]')!;
  expect(blocked).not.toBeNull();
  expect(blocked.title).toContain(text.includes("\u000B") ? "U+000B" : "U+000C");
  expect(blocked.querySelector(".bubble-text-selection")).not.toBeNull();
  blocked.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
  expect(document.querySelector<HTMLTextAreaElement>('[data-translation-editor] textarea')?.value).toBe(text);
  expect(document.querySelector('[data-translation-editor] [role="status"]')?.textContent).toContain(text.includes("\u000B") ? "U+000B" : "U+000C");
  expect(bubble.t).toBe(text);
});
test("renders permitted normalized Thai numerals without rewriting legacy stored text",async()=>{
  const bubble:TranslatedBubble={t:"เลข ١٢",box:[100,100,300,400]};
  await paint([bubble],"th");
  expect(ink.join("")).toContain("12");
  expect(ink.join("")).not.toContain("١٢");
  expect(bubble.t).toBe("เลข ١٢");
  expect(document.querySelector<HTMLElement>('[data-script-status="eligible"]')?.title).toContain("ตัวเลข");
});
