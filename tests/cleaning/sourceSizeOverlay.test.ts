import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { applyTranslationOverlay, type TranslatedBubble } from '@/lib/translationOverlay';
import { SOURCE_SIZE_POLICY, type SourceSizing } from '@/lib/sourceTextSize';
import { undoManager } from '@/lib/undoManager';
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
