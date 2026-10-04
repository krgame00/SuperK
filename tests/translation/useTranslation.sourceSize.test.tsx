import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { useTranslation } from '@/hooks/useTranslation';
import { applyTranslationOverlay } from '@/lib/translationOverlay';
import { undoManager } from '@/lib/undoManager';

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
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
test('source identity stays immutable across size revisions and missing source blocks human confirmation',()=>{
  const {result}=renderHook(()=>useTranslation({currentPage:0,pages:['blob:original'],pageSourceFingerprints:new Map([['blob:original','original-sha']]),viewMode:'single',preparePageForTranslation:async()=>({recognitionUrl:'blob:scoped',backgroundUrl:'blob:clean'})}));
  expect(result.current.getPageSourceRevision('blob:original')).toBe('original-sha');
  act(()=>result.current.markPageDirty('blob:original'));
  expect(result.current.getPageSourceRevision('blob:original')).toBe('original-sha');
  expect(result.current.getPageSourceRevision('blob:missing')).toBeUndefined();
});
test('saved page sizing skips manual and legacy locks; explicit point Auto preserves text and Undo evidence',async()=>{
  undoManager.clear();
  const {result}=renderHook(()=>useTranslation({currentPage:0,pages:['blob:original'],viewMode:'single',preparePageForTranslation:async()=>({recognitionUrl:'blob:scoped',backgroundUrl:'blob:clean'})}));
  const fresh={box:[0,0,1000,1000],original_text:'HELLO',t:'สวัสดี'};
  const legacy={...fresh,box:[100,100,200,200],targetFontSize:23,fontSizeMultiplier:1.2,layoutAdjustment:{bx:1,by:2,bw:90,bh:30,rotation:0,targetFontSize:23}};
  result.current.bubbleCacheRef.current.set('blob:original',[fresh,legacy]);
  result.current.translatedImageCacheRef.current.set('blob:original','stale');
  await act(async()=>{expect(await result.current.resizeSavedText({scope:'page',pageUrl:'blob:original'})).toBe(1);});
  expect(legacy.targetFontSize).toBe(23);
  expect(result.current.bubbleCacheRef.current.get('blob:original')![0].sourceSizing?.space?.contextKey).toBe('0,0,1000,1000|100,100,200,200');
  expect(result.current.translatedImageCacheRef.current.has('blob:original')).toBe(false);
  await act(async()=>{expect(await result.current.resizeSavedText({scope:'point',pageUrl:'blob:original',pointIndex:1,returnToAuto:true})).toBe(1);});
  expect(legacy).toMatchObject({t:'สวัสดี',sourceSizing:{mode:'auto'},layoutAdjustment:{bx:1,by:2,bw:90}});
  act(()=>{undoManager.undo();});
  expect(legacy).toMatchObject({targetFontSize:23,fontSizeMultiplier:1.2});
  expect('sourceSizing' in legacy).toBe(false);
  act(()=>{undoManager.redo();});
  expect(legacy).toMatchObject({sourceSizing:{mode:'auto'}});
});
test('global size change marks automatic points manual and Undo restores ownership; color keeps ownership',async()=>{
  undoManager.clear();
  const {result}=renderHook(()=>useTranslation({currentPage:0,pages:['blob:original'],viewMode:'single',preparePageForTranslation:async()=>({recognitionUrl:'blob:scoped',backgroundUrl:'blob:clean'})}));
  await act(async()=>{await result.current.handleTranslate();});
  const bubble=result.current.bubbleCacheRef.current.get('blob:original')![0];
  const evidence=structuredClone(bubble.sourceSizing);
  act(()=>result.current.setTextStyle(previous=>({...previous,textColor:'#123456'})));
  expect(bubble.sourceSizing?.mode).toBe('auto');
  act(()=>result.current.setTextStyle(previous=>({...previous,fontSizeMultiplier:1.2})));
  expect(bubble.sourceSizing?.mode).toBe('manual');
  act(()=>undoManager.undo());
  expect(bubble.sourceSizing).toEqual(evidence);
  expect(result.current.textStyle.textColor).toBe('#123456');
  expect(result.current.textStyle.fontSizeMultiplier).toBe(1);
});
test('public new translation action measures pre-clean original, persists automatic size before offscreen rendering',async()=>{
  const {result}=renderHook(()=>useTranslation({currentPage:0,pages:['blob:original'],viewMode:'single',
    preparePageForTranslation:async()=>({recognitionUrl:'blob:scoped',backgroundUrl:'blob:clean'})}));
  await act(async()=>{expect(await result.current.handleTranslate()).toBe(true);});
  const bubbles=vi.mocked(applyTranslationOverlay).mock.calls.find(c=>c[1]==='offscreen')?.[0];
  expect(bubbles?.[0].sourceSizing).toMatchObject({mode:'auto',status:'matched',evidence:{bodyHeightPx:10,sourceRevision:expect.stringMatching(/^100x40:/)}});
  expect(bubbles![0].targetFontSize! * bubbles![0].sourceSizing!.font!.bodyHeightPx / bubbles![0].sourceSizing!.font!.referencePx).toBe(10);
  expect(imageSources).toContain('blob:original');
  expect(result.current.getCurrentRenderedOutput('blob:original')?.url).toBe('data:render');
  act(()=>{result.current.bubbleCacheRef.current.get('blob:original')![0].t='changed-without-dirty';});
  expect(result.current.getCurrentRenderedOutput('blob:original')).toBeUndefined();
});

test.each(['abort','replace','revision'] as const)('source preparation discards pending work on %s',async(change)=>{
  let release!:()=>void;
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const pending=new Promise<void>(resolve=>{release=resolve;});
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:vi.fn(()=>{entered();return pending;}),check:()=>true}});
  const {result,rerender}=renderHook(({pages})=>useTranslation({currentPage:0,pages,viewMode:'single',
    preparePageForTranslation:async()=>({recognitionUrl:'blob:scoped',backgroundUrl:'blob:clean'})}),{initialProps:{pages:['blob:original']}});
  let work!:Promise<boolean>;
  await act(async()=>{work=result.current.handleTranslate();await started;});
  act(()=>{
    if(change==='abort') result.current.cancelTranslateAll();
    else if(change==='revision') result.current.invalidatePageTranslation('blob:original');
    else rerender({pages:['blob:replacement']});
  });
  await act(async()=>{release();await work;});
  expect(vi.mocked(applyTranslationOverlay).mock.calls.filter(c=>c[1]==='offscreen')).toHaveLength(0);
  expect(result.current.bubbleCacheRef.current.has('blob:original')).toBe(false);
  expect(result.current.translatedImageCacheRef.current.has('blob:original')).toBe(false);
});

test('crop source preparation discards a removed page during font loading',async()=>{
  let release!:()=>void;
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const pending=new Promise<void>(resolve=>{release=resolve;});
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:vi.fn(()=>{entered();return pending;}),check:()=>true}});
  const {result,rerender}=renderHook(({pages})=>useTranslation({currentPage:0,pages,viewMode:'single',
    preparePageForTranslation:async()=>({recognitionUrl:'blob:scoped',backgroundUrl:'blob:clean'})}),{initialProps:{pages:['blob:original']}});
  let work!:Promise<void>;
  await act(async()=>{work=result.current.translateCrop({x:0,y:0,w:100,h:40},'crop',100,40);await started;});
  act(()=>rerender({pages:['blob:replacement']}));
  await act(async()=>{release();await work;});
  expect(applyTranslationOverlay).not.toHaveBeenCalled();
  expect(result.current.bubbleCacheRef.current.has('blob:original')).toBe(false);
  expect(result.current.translatedImageCacheRef.current.has('blob:original')).toBe(false);
});

test('original image wait discards work aborted before pixel preparation',async()=>{
  vi.stubEnv('NODE_ENV','production');
  let release!:()=>void;
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  vi.stubGlobal('Image',class {
    naturalWidth=100;naturalHeight=40;width=100;height=40;complete=false;
    onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
    set src(value:string) {
      if(value==='blob:original') {release=()=>this.onload?.();entered();}
      else queueMicrotask(()=>this.onload?.());
    }
  });
  const {result}=renderHook(()=>useTranslation({currentPage:0,pages:['blob:original'],viewMode:'single',
    preparePageForTranslation:async()=>({recognitionUrl:'blob:scoped',backgroundUrl:'blob:clean'})}));
  let work!:Promise<boolean>;
  await act(async()=>{work=result.current.handleTranslate();await started;});
  act(()=>result.current.cancelTranslateAll());
  await act(async()=>{release();await work;});
  expect(document.fonts.load).not.toHaveBeenCalled();
  expect(vi.mocked(applyTranslationOverlay).mock.calls.filter(c=>c[1]==='offscreen')).toHaveLength(0);
  expect(result.current.bubbleCacheRef.current.has('blob:original')).toBe(false);
  expect(result.current.translatedImageCacheRef.current.has('blob:original')).toBe(false);
});
