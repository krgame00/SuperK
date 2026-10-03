import { applyTranslationOverlay, downloadTranslatedImage, type TranslatedBubble } from '../../lib/translationOverlay';
import { undoManager } from '../../lib/undoManager';

const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 80));

async function run() {
  const cases: string[] = [];
  document.body.style.margin = '0';
  let measurements = 0, draws = 0;
  const measure = CanvasRenderingContext2D.prototype.measureText;
  const draw = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.measureText = function(text) { measurements++; return measure.call(this, text); };
  CanvasRenderingContext2D.prototype.fillText = function(...args: Parameters<typeof draw>) { draws++; return draw.apply(this, args); };
  for (const zoom of [1, .44]) for (const rotation of [0, 30, 90, 180]) for (const font of ['sans-serif', 'serif']) {
    const by = rotation === 180 ? 1010 : 100;
    console.log('Checking', zoom, rotation, font);
    document.body.replaceChildren(); undoManager.clear(); localStorage.clear();
    const viewport = document.createElement('div');
    viewport.style.cssText = 'position:relative;width:1000px;height:1200px';
    const stage = document.createElement('div');
    stage.style.cssText = `position:relative;width:1000px;height:1200px;transform:scale(${zoom});transform-origin:0 0`;
    const chrome = document.createElement('div'); chrome.dataset.overlayChromeLayer = 'true';
    chrome.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    const image = new Image(); image.width = 1000; image.height = 1200;
    image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200"><rect width="1000" height="1200" fill="white"/></svg>');
    await image.decode(); stage.append(image); viewport.append(stage, chrome); document.body.append(viewport);
    const bubble: TranslatedBubble = { t: 'ที่นี่\nเป็นแค่\nส่วนหนึ่ง', box: [100,100,300,400], targetFontSize: 24,
      styleProfile: { fill: '#000000', outline: '#ffffff', hasOutline: true, outlineWidthRatio: .12,
        fillConfidence: 1, outlineConfidence: 1, source: 'manual', ownershipMode: 'manual', manualShadowMode: 'standard' },
      layoutAdjustment: { bx: 100, by, bw: 200, bh: 180, iw: 1000, ih: 1200, rotation, manualMinHeightPx: 180 } };
    const neighbor: TranslatedBubble = { t: 'N', box: [90,90,120,120], targetFontSize:12, isInvalidBox:true,
      layoutAdjustment:{bx:90,by:90,bw:30,bh:30,iw:1000,ih:1200,manualMinHeightPx:30} };
    const empty: TranslatedBubble = { t: '', box: [400,100,600,280], targetFontSize:24,
      layoutAdjustment:{bx:400,by:100,bw:200,bh:180,iw:1000,ih:1200,manualMinHeightPx:180} };
    await applyTranslationOverlay([bubble,neighbor,empty], 'single', 0, () => {}, undefined,
      { current: { fontFamily: font, textColor: '#000000', textOutline: '#ffffff', fontSizeMultiplier: 1 } }, stage);
    await pause();
    const wrapper = stage.querySelector<HTMLElement>('.translation-bubble-wrapper')!;
    const frame = wrapper.querySelector<HTMLElement>('.bubble-text-selection')!;
    const canvas = wrapper.querySelector('canvas')!;
    const wrappers = stage.querySelectorAll<HTMLElement>('.translation-bubble-wrapper');
    check(wrappers[2].querySelector<HTMLElement>('.bubble-text-selection')!.style.width==='100%','empty text fallback');
    const original = canvas.toDataURL();
    const originalExport = downloadTranslatedImage('single', 0, '', true, stage);
    const beforeLayout = JSON.stringify(bubble.layoutAdjustment);
    check(parseFloat(frame.style.width) < 100, 'text frame must be narrower than layout');
    check(parseFloat(frame.style.height) < 100, 'text frame must be shorter than layout');
    frame.scrollIntoView({ block: 'center' });
    const rect = frame.getBoundingClientRect();
    const inside = document.elementFromPoint((rect.left+rect.right)/2, (rect.top+rect.bottom)/2);
    check(inside === frame, `real browser hit testing inside frame: ${inside?.className}, rect ${JSON.stringify(rect.toJSON())}`);
    const pixels = canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height);
    const x = parseFloat(frame.style.left)/100*canvas.width, y=parseFloat(frame.style.top)/100*canvas.height;
    const right=x+parseFloat(frame.style.width)/100*canvas.width, bottom=y+parseFloat(frame.style.height)/100*canvas.height;
    for (let py=0;py<pixels.height;py++) for(let px=0;px<pixels.width;px++) {
      if(pixels.data[(py*pixels.width+px)*4+3]>8) check(px>=Math.floor(x)&&px<=Math.ceil(right)&&py>=Math.floor(y)&&py<=Math.ceil(bottom),'visible glyph/effect outside selection');
    }
    if (rotation===0) {
      const stageRect=stage.getBoundingClientRect();
      const outside = document.elementFromPoint(stageRect.left+105*zoom,stageRect.top+105*zoom);
      check(outside !== frame && outside !== wrapper,'old empty layout must not intercept clicks');
      check(outside===wrappers[1].querySelector('.bubble-text-selection'),'neighbor must remain clickable inside old layout');
    }
    frame.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,pointerId:1}));
    frame.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,pointerId:1}));
    check(wrapper.dataset.selected==='true','selection via frame');
    check(canvas.toDataURL()===original && JSON.stringify(bubble.layoutAdjustment)===beforeLayout,'selection changed drawing or saved geometry');
    check(downloadTranslatedImage('single', 0, '', true, stage)===originalExport,'selection chrome changed export');
    await pause();
    const bounds = () => {
      const w=parseFloat(wrapper.style.width)*10,h=parseFloat(wrapper.style.height)*12;
      const localX=parseFloat(frame.style.left)/100*w;
      const localY=(parseFloat(frame.style.top)+parseFloat(frame.style.height))/100*h;
      const angle=rotation*Math.PI/180;
      return {x:parseFloat(wrapper.style.left)*10+w/2+(localX-w/2)*Math.cos(angle)-(localY-h/2)*Math.sin(angle),
        y:parseFloat(wrapper.style.top)*12+h/2+(localX-w/2)*Math.sin(angle)+(localY-h/2)*Math.cos(angle)};
    };
    const scaleHandle=chrome.querySelector<HTMLElement>('.action-handle--scale')!;
    const handleRect = scaleHandle.getBoundingClientRect();
    check(document.elementFromPoint(handleRect.left+handleRect.width/2,handleRect.top+handleRect.height/2)?.closest('.action-handle--scale')===scaleHandle,'real handle hit testing');
    const w=parseFloat(wrapper.style.width)*10,h=parseFloat(wrapper.style.height)*12;
    const lx=(parseFloat(frame.style.left)+parseFloat(frame.style.width))/100*w;
    const ly=parseFloat(frame.style.top)/100*h, angle=rotation*Math.PI/180;
    const stageRect=stage.getBoundingClientRect();
    const expectedX=stageRect.left+(parseFloat(wrapper.style.left)*10+w/2+(lx-w/2)*Math.cos(angle)-(ly-h/2)*Math.sin(angle))*zoom;
    const expectedY=stageRect.top+(parseFloat(wrapper.style.top)*12+h/2+(lx-w/2)*Math.sin(angle)+(ly-h/2)*Math.cos(angle))*zoom;
    check(Math.abs(handleRect.left+handleRect.width/2-expectedX)<.5&&Math.abs(handleRect.top+handleRect.height/2-expectedY)<.5,'handle does not follow visible corner');
    // Synthetic dispatch tests interaction state; real elementFromPoint above tests hit routing.
    scaleHandle.setPointerCapture=()=>{}; scaleHandle.releasePointerCapture=()=>{}; scaleHandle.hasPointerCapture=()=>true;
    const anchor=bounds();
    const fire=(target:HTMLElement,type:string,cx:number,cy:number)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:cx,clientY:cy,pointerId:1}));
    for (const id of ['move','rotate']) {
      const handle=chrome.querySelector<HTMLElement>(`.action-handle--${id}`)!;
      handle.setPointerCapture=()=>{};handle.releasePointerCapture=()=>{};handle.hasPointerCapture=()=>true;
      const count=measurements, drawCount=draws;
      fire(handle,'pointerdown',200*zoom,200*zoom);fire(handle,'pointermove',230*zoom,220*zoom);await pause();
      check(measurements===count&&draws===drawCount,'move/rotation preview remeasured text');
      fire(handle,'pointercancel',230*zoom,220*zoom);
      check(canvas.toDataURL()===original,'move/rotation cancel changed bitmap');
    }
    const dx=rotation===180?-60:40,dy=rotation===180?54:-30;
    fire(scaleHandle,'pointerdown',200*zoom,200*zoom);fire(scaleHandle,'pointermove',(200+dx)*zoom,(200+dy)*zoom);await pause();fire(scaleHandle,'pointerup',(200+dx)*zoom,(200+dy)*zoom);
    const after=bounds();check(Math.abs(anchor.x-after.x)<.01&&Math.abs(anchor.y-after.y)<.01,'opposite visible corner drifted');
    const scaled = canvas.toDataURL(), scaledExport = downloadTranslatedImage('single', 0, '', true, stage);
    const saved = JSON.parse(JSON.stringify(bubble)) as TranslatedBubble;
    undoManager.undo();check(canvas.toDataURL()===original,'undo must restore original drawing');
    undoManager.redo();undoManager.undo();
    const widthHandle=chrome.querySelector<HTMLElement>('.action-handle--width')!;
    widthHandle.setPointerCapture=()=>{};widthHandle.releasePointerCapture=()=>{};widthHandle.hasPointerCapture=()=>true;
    fire(widthHandle,'pointerdown',200*zoom,200*zoom);check(frame.style.width==='100%','width preview');
    fire(widthHandle,'pointermove',230*zoom,200*zoom);await pause();fire(widthHandle,'pointercancel',230*zoom,200*zoom);
    check(parseFloat(frame.style.width)<100&&canvas.toDataURL()===original,'cancel width restore');
    check(parseFloat(wrapper.style.top)*12+parseFloat(wrapper.style.height)*12<=1200+.001,'scaled layout crossed bottom edge');
    await applyTranslationOverlay([saved,neighbor,empty], 'single', 0, () => {}, undefined,
      { current: { fontFamily: font, textColor: '#000000', textOutline: '#ffffff', fontSizeMultiplier: 1 } }, stage);
    await pause();
    check(stage.querySelector('canvas')!.toDataURL()===scaled,'reopened canvas differs');
    check(downloadTranslatedImage('single',0,'',true,stage)===scaledExport,'reopened export differs');
    const exportStage = document.createElement('div'); exportStage.id='offscreen-container';
    exportStage.style.cssText='position:relative;width:1000px;height:1200px';
    exportStage.append(image.cloneNode());document.body.append(exportStage);
    await applyTranslationOverlay([saved,neighbor,empty], 'offscreen', -1, () => {}, undefined,
      { current: { fontFamily: font, textColor: '#000000', textOutline: '#ffffff', fontSizeMultiplier: 1 } });
    await pause();
    check(downloadTranslatedImage('offscreen',-1,'',true,exportStage)===scaledExport,'workspace/offscreen export differs');
    cases.push(`${font}, rotation ${rotation}, zoom ${zoom}`);
  }
  return {ok:true,cases};
}
(window as unknown as { selectionCheck: Promise<unknown> }).selectionCheck=run().catch(error=>({ok:false,error:String(error),stack:error.stack}));
