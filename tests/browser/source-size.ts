import { applyTranslationOverlay, downloadTranslatedImage, type TranslatedBubble } from '../../lib/translationOverlay';
import { prepareNewSourceSizing } from '../../lib/sourceTextSizeClient';
import { undoManager } from '../../lib/undoManager';
const check=(ok:boolean,message:string)=>{if(!ok)throw new Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
const visibleHeight=(canvas:HTMLCanvasElement)=>{
  const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
  let top=canvas.height,bottom=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const i=(y*canvas.width+x)*4;
    if(pixels[i+3]>40 && pixels[i]<80&&pixels[i+1]<80&&pixels[i+2]<80){top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  return bottom<top?0:bottom-top+1;
};
async function run(){
  const rows=[];
  for(const zoom of [.44,1,1.5])for(const [family,text] of [['sans-serif','EEEEEE'],['serif','EEEEEE'],['Tahoma','กิ่ กิ่ กิ่']])for(const nominal of family==='Tahoma'?[16,30]:[7,8,16,30]){
    document.body.replaceChildren();localStorage.clear();undoManager.clear();
    const original=document.createElement('canvas');original.width=300;original.height=160;
    const source=original.getContext('2d')!;source.fillStyle='#fff';source.fillRect(0,0,300,160);source.fillStyle='#000';source.font=`bold ${nominal}px sans-serif`;
    // Controlled placement on a connected dark stem distinguishes a reliable
    // tiny fixture from antialiased stems fragmented at subpixel positions.
    for(const y of [50,110])for(let glyph=0;glyph<6;glyph++) source.fillText('E',28.5+glyph*35,y);
    const originalImage=new Image();originalImage.src=original.toDataURL();await originalImage.decode();
    const bubble:TranslatedBubble={box:[1,1,999,999],original_text:'E E E E E E\nE E E E E E',t:text};
    await prepareNewSourceSizing([bubble],originalImage,family);
    check(bubble.sourceSizing?.status==='matched',`source ${nominal} was not reliable: ${JSON.stringify(bubble.sourceSizing)}`);
    const sourceBody=bubble.sourceSizing!.evidence.bodyHeightPx!;
    const viewport=document.createElement('div'),stage=document.createElement('div');stage.id='pageContainer';
    stage.style.cssText=`position:relative;width:300px;height:160px;transform:scale(${zoom});transform-origin:0 0`;
    const clean=new Image();clean.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="100%" height="100%" fill="white"/></svg>');await clean.decode();
    const chrome=document.createElement('div');chrome.dataset.overlayChromeLayer='true';viewport.append(stage,chrome);stage.append(clean);document.body.append(viewport);
    const style={current:{fontFamily:family,fontSizeMultiplier:1,textColor:'#000000',textOutline:'#ffffff'}};
    await applyTranslationOverlay([bubble],'single',0,()=>{},undefined,style,stage);await pause();
    const output=stage.querySelector<HTMLCanvasElement>('.tl-canvas canvas')!;
    const outputBody=visibleHeight(output),error=Math.abs(outputBody-sourceBody);
    check(error/sourceBody<=.10 || error<1,`${family} ${text} ${nominal} zoom ${zoom}: body ${sourceBody} vs ${outputBody}; ${JSON.stringify(bubble.sourceSizing)}; canvas ${output.width}x${output.height}`);
    const bitmap=output.toDataURL(),exported=downloadTranslatedImage('single',0,'',true,stage);
    const saved=JSON.parse(JSON.stringify(bubble)) as TranslatedBubble;
    await applyTranslationOverlay([saved],'single',0,()=>{},undefined,style,stage);await pause();
    check(stage.querySelector<HTMLCanvasElement>('.tl-canvas canvas')!.toDataURL()===bitmap,'saved reload changed rendered glyphs');
    check(downloadTranslatedImage('single',0,'',true,stage)===exported,'saved reload changed export');
    const offscreen=document.createElement('div');offscreen.style.cssText='position:relative;width:300px;height:160px';offscreen.append(clean.cloneNode());document.body.append(offscreen);
    await applyTranslationOverlay([saved],'offscreen',0,()=>{},undefined,style,offscreen);await pause();
    check(downloadTranslatedImage('offscreen',0,'',true,offscreen)===exported,'offscreen export changed source-matched glyphs');
    rows.push({zoom,family,text,sourceNominal:nominal,sourceBodyPx:sourceBody,outputBodyPx:outputBody,baseFontSizePx:bubble.targetFontSize,errorPx:error,relativeError:error/sourceBody,status:bubble.sourceSizing!.status,reloadEqual:true,exportEqual:true});
  }
  const uncertainty=[];
  for(const fragmented of [true,false]) {
    const sourceCanvas=document.createElement('canvas');sourceCanvas.width=300;sourceCanvas.height=160;
    const source=sourceCanvas.getContext('2d')!;source.fillStyle='#fff';source.fillRect(0,0,300,160);
    source.fillStyle='#000';source.font='bold 8px sans-serif';
    for(const y of [50,110]) {
      if(fragmented)source.fillText('E E E E E E',20,y);
      else for(let glyph=0;glyph<6;glyph++)source.fillText('E',28.5+glyph*35,y);
    }
    const original=new Image();original.src=sourceCanvas.toDataURL();await original.decode();
    const bubble:TranslatedBubble={box:[1,1,999,999],original_text:'E E E E E E',t:fragmented?'EEEEEE':'กิ่ กิ่ กิ่'};
    await prepareNewSourceSizing([bubble],original,fragmented?'sans-serif':'Tahoma');
    check(bubble.sourceSizing?.status==='fallback',`uncertain ${fragmented?'source':'font'} claimed a match`);
    check(Boolean(bubble.sourceSizing?.fallbackLabel),'uncertainty lacked fallback label');
    if(!fragmented)check(bubble.sourceSizing?.font?.loaded===true && bubble.sourceSizing.font.reliable===false,'font uncertainty was mislabeled as font load failure');
    uncertainty.push({kind:fragmented?'fragmented-antialiased-source':'small-thai-raster-gap',sizing:bubble.sourceSizing});
  }
  return {ok:true,rows,uncertainty};
}
(window as unknown as {sourceSizeCheck:Promise<unknown>}).sourceSizeCheck=run().catch(error=>({ok:false,error:String(error),stack:error.stack}));




