import { beforeEach, expect, test, vi } from 'vitest';
import { prepareNewSourceSizing } from '@/lib/sourceTextSizeClient';
import type { TranslatedBubble } from '@/lib/translationOverlay';
import type { SourceSizing } from '@/lib/sourceTextSize';
type SizedBubble = TranslatedBubble & {sourceSizing?:SourceSizing};

beforeEach(()=>vi.restoreAllMocks());
test('new translations retain original pixel evidence and loaded-font base size; legacy sizes stay intact',async()=>{
  const width=100,height=40,rgba=new Uint8ClampedArray(width*height*4).fill(255);
  for(let g=0;g<5;g++) for(let y=10;y<20;y++) for(let x=10+g*15;x<16+g*15;x++) {const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;}
  const ctx={drawImage:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),font:'',measureText:()=>({actualBoundingBoxAscent:70,actualBoundingBoxDescent:10}),
    getImageData:(_x:number,_y:number,w:number)=> {
      if(w!==256) return {data:rgba};
      const data=new Uint8ClampedArray(256*256*4).fill(255);
      const height=Math.round(parseFloat(ctx.font.replace('bold ',''))*.8);
      for(let y=100;y<100+height;y++){const i=(y*256+128)*4;data[i]=data[i+1]=data[i+2]=0;}
      return {data};
    }};
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:vi.fn().mockResolvedValue([{}]),check:()=>true}});
  const image={naturalWidth:width,naturalHeight:height,width,height} as HTMLImageElement;
  const fresh:SizedBubble={box:[0,0,1000,1000],original_text:'HELLO',t:'กิ่'};
  const legacy:TranslatedBubble={box:[0,0,1000,1000],original_text:'HELLO',t:'saved',targetFontSize:23};
  await prepareNewSourceSizing([fresh,legacy],image,'Actual Font');
  expect(fresh.sourceSizing?.status).toBe('matched');
  expect(fresh.targetFontSize! * fresh.sourceSizing!.font!.bodyHeightPx / fresh.sourceSizing!.font!.referencePx).toBe(10);
  expect(fresh.sourceSizing?.evidence.rect).toEqual({x:0,y:0,width:100,height:40});
  expect(fresh.sourceSizing?.evidence.sourceRevision).toMatch(/^100x40:/);
  expect(legacy.targetFontSize).toBe(23);
  expect(legacy.sourceSizing).toBeUndefined();
  const before=fresh.sourceSizing;
  await prepareNewSourceSizing([fresh,legacy],image,'Actual Font');
  expect(fresh.sourceSizing).toBe(before);
  fresh.t='Latin';
  await prepareNewSourceSizing([fresh],image,'Actual Font');
  expect(fresh.sourceSizing?.font?.textKey).toBe('Latin');
  expect(fresh.sourceSizing?.evidence.sourceRevision).toBe(before?.evidence.sourceRevision);
  fresh.box=[1,1,999,999];
  await prepareNewSourceSizing([fresh],image,'Other Font');
  expect(fresh.sourceSizing?.evidence.regionKey).toBe('1,1,999,999');
  expect(fresh.sourceSizing?.font?.family).toBe('Other Font');
  rgba[0]=0;
  await prepareNewSourceSizing([fresh,legacy],image,'Other Font');
  expect(fresh.sourceSizing?.evidence.sourceRevision).not.toBe(before?.evidence.sourceRevision);
  expect(legacy.targetFontSize).toBe(23);
  const matchedSize=fresh.sourceSizing!.baseFontSizePx!;
  fresh.targetFontSize=matchedSize;
  fresh.layoutAdjustment={bx:0,by:0,bw:100,bh:40,iw:100,ih:40,targetFontSize:matchedSize};
  const independent={...fresh,targetFontSize:29,layoutAdjustment:{...fresh.layoutAdjustment,targetFontSize:31}};
  ctx.getImageData=()=>{throw new Error('unreadable replacement');};
  await prepareNewSourceSizing([fresh,independent,legacy],image,'Other Font');
  expect(fresh.sourceSizing?.status).toBe('fallback');
  expect(fresh.sourceSizing?.evidence.reason).toBe('original-pixels-unavailable');
  expect(fresh.targetFontSize).toBeUndefined();
  expect(fresh.layoutAdjustment?.targetFontSize).toBeUndefined();
  expect(independent.sourceSizing?.status).toBe('fallback');
  expect(independent.targetFontSize).toBe(29);
  expect(independent.layoutAdjustment.targetFontSize).toBe(31);
});
test('font load rejection and absent original pixels preserve editing with a labeled fallback',async()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:vi.fn().mockRejectedValue(new Error('font missing'))}});
  const bubble:SizedBubble={box:[0,0,1000,1000],original_text:'HELLO',t:'translated'};
  await prepareNewSourceSizing([bubble],{} as HTMLImageElement,'Missing Font');
  expect(bubble.sourceSizing?.fallbackLabel).toBe('ยังเทียบขนาดต้นฉบับไม่ได้');
  expect(bubble.targetFontSize).toBeUndefined();
});
