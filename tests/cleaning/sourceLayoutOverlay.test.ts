import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { applyTranslationOverlay, type TranslatedBubble } from '@/lib/translationOverlay';
import { SOURCE_SIZE_POLICY, type SourceSizing } from '@/lib/sourceTextSize';
import { undoManager } from '@/lib/undoManager';
import { SOURCE_SPACE_POLICY } from '@/lib/sourceTextSpace';
vi.mock('@/lib/colorMatching/canvasSampler',()=>({sampleBubbleRegion:()=>null,sampleRectRegion:()=>null}));

let renderedFonts:string[], reads:number;
beforeEach(()=>{
  vi.useFakeTimers();undoManager.clear();renderedFonts=[];reads=0;
  const storage=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
  document.body.innerHTML='<div id="pageContainer"><img /></div>';
  const img=document.querySelector('img')!;
  Object.defineProperties(img,{naturalWidth:{value:1000},naturalHeight:{value:1000},complete:{value:true}});
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:vi.fn().mockResolvedValue([{}]),check:()=>true}});
  const context={font:'',measureText:(s:string)=>({width:s.length*4,actualBoundingBoxAscent:75,actualBoundingBoxDescent:5}),
    fillText:function(this:CanvasRenderingContext2D){renderedFonts.push(this.font);},
    getImageData:(_x:number,_y:number,w:number)=>{
      if(w!==256) {reads++;return {data:new Uint8ClampedArray(4)};}
      const data=new Uint8ClampedArray(256*256*4).fill(255);
      const height=Math.round(parseFloat(context.font.replace('bold ',''))*.8);
      for(let y=100;y<100+height;y++){const i=(y*256+128)*4;data[i]=data[i+1]=data[i+2]=0;}
      return {data};
    }};
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(new Proxy(context,{get:(t,p)=>p in t?t[p as keyof typeof t]:vi.fn()}) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:render');
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
const sizing=():SourceSizing=>({mode:'auto',status:'matched',baseFontSizePx:5,
  font:{family:'sans-serif',textKey:'Hello',referencePx:100,bodyHeightPx:80,loaded:true},
  evidence:{policyVersion:SOURCE_SIZE_POLICY,sourceRevision:'1000x1000:pixels',regionKey:'100,100,300,400',pixelRevision:'crop',rect:{x:100,y:100,width:300,height:200},quality:'reliable',confidence:.9,reason:'glyphs',bodyHeightPx:4,glyphCount:5,lineCount:1},readabilityWarning:'ข้อความต้นฉบับขนาดเล็ก อาจอ่านยาก'});
async function paint(b:TranslatedBubble,family='sans-serif') {
  await applyTranslationOverlay([b],'single',0,()=>{},undefined,{current:{fontFamily:family,fontSizeMultiplier:1}},undefined,undefined,undefined,b.t==='Hello'?'en':'th');
  await vi.advanceTimersByTimeAsync(250);
}
test('unknown source space preserves original layout, size and complete overflowing words',async()=>{
  const text='extraordinary extraordinary extraordinary extraordinary extraordinary';
  const b:TranslatedBubble={t:text,box:[100,100,120,160],targetFontSize:20,sourceSizing:{...sizing(),baseFontSizePx:20,
    font:{...sizing().font!,textKey:text},evidence:{...sizing().evidence,regionKey:'100,100,120,160'}}};
  await applyTranslationOverlay([b],'single',0,()=>{},undefined,{current:{fontFamily:'sans-serif',fontSizeMultiplier:1}},undefined,undefined,undefined,'en');
  await vi.advanceTimersByTimeAsync(250);
  const frame=document.querySelector<HTMLElement>('.translation-bubble-wrapper')!;
  expect([frame.style.left,frame.style.top,frame.style.width,frame.style.height]).toEqual(['10%','10%','6%','2%']);
  expect(frame.dataset.layoutOverflow).toBe('true');
  expect(renderedFonts.every(font=>font==='bold 20px sans-serif')).toBe(true);
});
test('reliable original space allows contained growth and recalibration retains ownership metadata',async()=>{
  const text='Hello Hello Hello Hello Hello Hello';
  const source=sizing();source.baseFontSizePx=20;source.font={...source.font!,textKey:text};
  source.space={policyVersion:SOURCE_SPACE_POLICY,sourceRevision:source.evidence.sourceRevision,regionKey:source.evidence.regionKey,quality:'reliable',reason:'closed',rect:{x:100,y:100,width:300,height:350}};
  source.sourceInputKey='original-key';
  const b:TranslatedBubble={t:text,box:[100,100,300,400],targetFontSize:20,sourceSizing:source,
    layoutAdjustment:{bx:100,by:100,bw:100,bh:20,iw:1000,ih:1000,targetFontSize:20}};
  await applyTranslationOverlay([b],'single',0,()=>{},undefined,{current:{fontFamily:'sans-serif',fontSizeMultiplier:1}},undefined,undefined,undefined,'en');
  await vi.advanceTimersByTimeAsync(250);
  const frame=document.querySelector<HTMLElement>('.translation-bubble-wrapper')!;
  expect(parseFloat(frame.style.height)).toBeGreaterThan(2);
  expect(parseFloat(frame.style.height)).toBeLessThanOrEqual(35);
  b.t='New words';b.render!();
  expect(b.sourceSizing?.space).toEqual(source.space);
  expect(b.sourceSizing?.sourceInputKey).toBe('original-key');
});
test('matched original small size renders below legacy floor and survives saved reload',async()=>{
  const b:TranslatedBubble={t:'Hello',box:[100,100,300,400],targetFontSize:5,sourceSizing:sizing()};
  await paint(b);
  expect(renderedFonts).toContain('bold 5px sans-serif');
  expect(document.querySelector('[data-source-sizing-status]')?.getAttribute('data-source-sizing-status')).toBe('matched');
  expect(document.querySelector('[data-source-sizing-status]')?.getAttribute('title')).toContain('อ่านยาก');
  await paint(JSON.parse(JSON.stringify(b)));
  expect(renderedFonts.at(-1)).toBe('bold 5px sans-serif');
  expect(reads).toBe(0);
});
test('font/text revisions use actual glyph metrics without reanalyzing original pixels',async()=>{
  const b:TranslatedBubble={t:'กิ่',box:[100,100,300,400],targetFontSize:5,sourceSizing:sizing()};
  await paint(b,'serif');
  expect(b.sourceSizing).toMatchObject({status:'matched',font:{family:'serif',textKey:'กิ่'}});
  expect(b.targetFontSize! * b.sourceSizing!.font!.bodyHeightPx / b.sourceSizing!.font!.referencePx).toBe(4);
  expect(reads).toBe(0);
});
test('changed source region invalidates auto base and visibly labels existing-sizing fallback',async()=>{
  const b:TranslatedBubble={t:'Hello',box:[100,100,300,500],targetFontSize:5,sourceSizing:sizing()};
  await paint(b);
  expect(b.targetFontSize).toBeUndefined();
  expect(b.sourceSizing).toMatchObject({status:'fallback',fallbackLabel:'ยังเทียบขนาดต้นฉบับไม่ได้'});
  expect(document.querySelector('[data-source-sizing-status]')?.getAttribute('title')).toContain('ยังเทียบขนาดต้นฉบับไม่ได้');
});
test('legacy locked size keeps its value and existing readable floor',async()=>{
  const b:TranslatedBubble={t:'Hello',box:[100,100,300,400],targetFontSize:5};
  await paint(b);
  expect(renderedFonts).toContain('bold 8px sans-serif');
  expect(b.targetFontSize).toBe(5);
  expect(b.sourceSizing).toBeUndefined();
});
test('region invalidation discards the same derived size in saved layout before rendering fallback',async()=>{
  const b:TranslatedBubble={t:'Hello',box:[100,100,300,500],targetFontSize:5,sourceSizing:sizing(),
    layoutAdjustment:{bx:100,by:100,bw:200,bh:300,iw:1000,ih:1000,targetFontSize:5}};
  await paint(b);
  expect(renderedFonts).not.toContain('bold 8px sans-serif');
  expect(b.layoutAdjustment?.targetFontSize).toBeUndefined();
});
// Deterministic wrap seam: 24 whole "extraordinary" words (52px each at 20px)
// never share a line inside a 100px-wide oval frame, so the fixed-font layout
// needs exactly ceil(24 * 20 * 1.3 / 0.88) = 710px regardless of chord shapes.
const longWords=Array.from({length:24},()=>'extraordinary').join(' ');
const matchedSizing=():SourceSizing=>{
  const source=sizing();source.baseFontSizePx=20;
  source.font={...source.font!,textKey:longWords};
  source.evidence={...source.evidence,regionKey:'100,100,300,200'};
  source.space={policyVersion:SOURCE_SPACE_POLICY,sourceRevision:source.evidence.sourceRevision,
    regionKey:'100,100,300,200',quality:'reliable',reason:'closed-white-space',rect:{x:100,y:100,width:100,height:550}};
  return source;
};
const renderWords=async(bubbles:TranslatedBubble[])=>{
  await applyTranslationOverlay(bubbles,'single',0,()=>{},undefined,
    {current:{fontFamily:'sans-serif',fontSizeMultiplier:1}},undefined,undefined,undefined,'en');
  await vi.advanceTimersByTimeAsync(250);
  return document.querySelectorAll<HTMLElement>('.translation-bubble-wrapper');
};
test('first matched render keeps the original box and grows only inside the closed space',async()=>{
  const b:TranslatedBubble={t:longWords,box:[100,100,300,200],targetFontSize:20,sourceSizing:matchedSizing()};
  const frames=await renderWords([b]);
  const frame=frames[0]!;
  expect([frame.style.left,frame.style.top,frame.style.width]).toEqual(['10%','10%','10%']);
  // 710px requested, closed space ends at y=650, so contained growth stops at 55%.
  expect(parseFloat(frame.style.height)).toBeCloseTo(55,6);
  expect(frame.dataset.layoutOverflow).toBe('true');
  expect(renderedFonts.every(font=>font==='bold 20px sans-serif')).toBe(true);
});
test('moved translated neighbors cap contained growth using conservative rotated bounds',async()=>{
  const a:TranslatedBubble={t:longWords,box:[100,100,300,200],targetFontSize:20,sourceSizing:matchedSizing()};
  // A 45deg neighbor's axis-aligned bound is |w·cos|+|h·sin| wide/tall around the
  // same center: its top edge rises from y=441.42 to exactly y=400.
  const neighbor=(rotation:number):TranslatedBubble=>({t:'x',
    layoutAdjustment:{bx:150,by:441.4213562373095,bw:200,bh:200,iw:1000,ih:1000,rotation}});
  const rotated=await renderWords([a,neighbor(45)]);
  expect(parseFloat(rotated[0]!.style.height)).toBeCloseTo(30,6);
  expect(rotated[0]!.dataset.layoutOverflow).toBe('true');
  // A renders before the neighbor, whose own legacy fit may pick another size.
  expect(renderedFonts[0]).toBe('bold 20px sans-serif');
  const unrotated=await renderWords([a,neighbor(0)]);
  expect(parseFloat(unrotated[0]!.style.height)).toBeCloseTo(34.14213562373095,3);
});
