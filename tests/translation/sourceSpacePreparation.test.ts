import { afterEach, expect, test, vi } from 'vitest';
import { prepareNewSourceSizing } from '@/lib/sourceTextSizeClient';
import type { TranslatedBubble } from '@/lib/translationOverlay';
afterEach(()=>vi.restoreAllMocks());
test('preparation persists original closed-space evidence and invalidates shared text space',async()=>{
  const width=100,height=100,rgba=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=10;y<=80;y++)for(let x=10;x<=80;x++)if(x===10||x===80||y===10||y===80){const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;}
  const ctx={drawImage:vi.fn(),font:'',measureText:()=>({actualBoundingBoxAscent:8,actualBoundingBoxDescent:2}),getImageData:()=>({data:rgba})};
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:async()=>[],check:()=>false}});
  const bubble:TranslatedBubble={box:[300,300,400,500],original_text:'ABC',t:'translation'};
  const image={naturalWidth:width,naturalHeight:height} as HTMLImageElement;
  await prepareNewSourceSizing([bubble],image,'sans-serif');
  expect(bubble.sourceSizing?.space?.quality).toBe('reliable');
  const previous=bubble.sourceSizing;
  await prepareNewSourceSizing([bubble],image,'sans-serif');
  expect(bubble.sourceSizing).toBe(previous);
  const other:TranslatedBubble={box:[600,400,700,500],original_text:'DEF',t:'other'};
  await prepareNewSourceSizing([bubble,other],image,'sans-serif');
  expect(bubble.sourceSizing?.space?.quality).toBe('unreliable');
  expect(bubble.sourceSizing?.space?.reason).toBe('shared-space-with-other-text');
  const beforeDirection=bubble.sourceSizing;
  bubble.sourceRotation=90;
  await prepareNewSourceSizing([bubble,other],image,'sans-serif');
  expect(bubble.sourceSizing).not.toBe(beforeDirection);
});
