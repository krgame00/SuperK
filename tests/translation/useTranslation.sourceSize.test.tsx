import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { useTranslation } from '@/hooks/useTranslation';
import { applyTranslationOverlay } from '@/lib/translationOverlay';

vi.mock('@/lib/translationOverlay',async(importOriginal)=>({...(await importOriginal<typeof import('@/lib/translationOverlay')>()),applyTranslationOverlay:vi.fn(async(_b,_v,_i,_s,done)=>done?.('data:render'))}));
vi.mock('@/lib/projectStore',()=>({saveProjectSession:vi.fn().mockResolvedValue(undefined),loadProjectSession:vi.fn().mockResolvedValue(null),clearProjectSession:vi.fn(),deleteAsset:vi.fn()}));
let imageSources:string[];
beforeEach(()=>{
  vi.clearAllMocks();imageSources=[];
  const storage=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
  const width=100,height=40,rgba=new Uint8ClampedArray(width*height*4).fill(255);
  for(let g=0;g<5;g++)for(let y=10;y<20;y++)for(let x=10+g*15;x<16+g*15;x++){const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;}
  vi.stubGlobal('Image',class {naturalWidth=width;naturalHeight=height;width=width;height=height;src='';complete=true;onload=null;onerror=null;});
  const ctx={font:'',fillRect:vi.fn(),fillText:vi.fn(),drawImage:(img:HTMLImageElement)=>imageSources.push(img.src),measureText:()=>({width:5,actualBoundingBoxAscent:70,actualBoundingBoxDescent:10}),
    getImageData:(_x:number,_y:number,w:number)=>{
      if(w!==256)return {data:rgba};
      const data=new Uint8ClampedArray(256*256*4).fill(255);
      const height=Math.round(parseFloat(ctx.font.replace('bold ',''))*.8);
      for(let y=100;y<100+height;y++){const i=(y*256+128)*4;data[i]=data[i+1]=data[i+2]=0;}
      return {data};
    }};
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:vi.fn().mockResolvedValue([{}]),check:()=>true}});
  vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
    if(String(input)==='blob:scoped')return new Response(new Blob(['scope'],{type:'image/png'}));
    if(String(input)==='/api/translate')return Response.json({text:JSON.stringify({bubbles:[{box:[0,0,1000,1000],original_text:'HELLO',t:'สวัสดี'}]})});
    if(String(input)==='/api/translation-review')return Response.json({reviews:[]});
    throw new Error(`Unexpected fetch ${input}`);
  });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
test('public new translation action measures pre-clean original, persists automatic size before offscreen rendering',async()=>{
  const {result}=renderHook(()=>useTranslation({currentPage:0,pages:['blob:original'],viewMode:'single',
    preparePageForTranslation:async()=>({recognitionUrl:'blob:scoped',backgroundUrl:'blob:clean'})}));
  await act(async()=>{expect(await result.current.handleTranslate()).toBe(true);});
  const bubbles=vi.mocked(applyTranslationOverlay).mock.calls.find(c=>c[1]==='offscreen')?.[0];
  expect(bubbles?.[0].sourceSizing).toMatchObject({mode:'auto',status:'matched',evidence:{bodyHeightPx:10,sourceRevision:expect.stringMatching(/^100x40:/)}});
  expect(bubbles![0].targetFontSize! * bubbles![0].sourceSizing!.font!.bodyHeightPx / bubbles![0].sourceSizing!.font!.referencePx).toBe(10);
  expect(imageSources).toContain('blob:original');
});
