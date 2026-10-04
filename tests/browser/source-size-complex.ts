import { prepareNewSourceSizing } from '../../lib/sourceTextSizeClient';
import { applyTranslationOverlay, downloadTranslatedImage, type TranslatedBubble } from '../../lib/translationOverlay';
const check=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};
async function run() {
  const rows=[];
  for(const zoom of [.44,1,1.5])for(const mode of ['vertical','rotated90','rotated30']) {
    const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;
    canvas.style.transform=`scale(${zoom})`;document.body.append(canvas);
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,300,300);
    ctx.fillStyle='#000';ctx.font='bold 30px sans-serif';
    if(mode==='vertical')for(let n=0;n<5;n++)ctx.fillText('E',140,50+n*45);
    else {ctx.translate(150,150);ctx.rotate((mode==='rotated90'?90:30)*Math.PI/180);for(let n=0;n<5;n++)ctx.fillText('E',-110+n*45,10);}
    const image=new Image();image.src=canvas.toDataURL();await image.decode();
    const bubble:TranslatedBubble={box:[1,1,999,999],original_text:'EEEEE',t:'EEEEE',
      ...(mode==='vertical'?{}:{sourceRotation:mode==='rotated90'?90:30})};
    await prepareNewSourceSizing([bubble],image,'sans-serif');
    check(bubble.sourceSizing?.status==='matched',`${mode}: ${JSON.stringify(bubble.sourceSizing)}`);
    const sizing=bubble.sourceSizing!,sourceBody=sizing.evidence.bodyHeightPx!,outputBody=sizing.font!.bodyHeightPx;
    // Canvas E at 30px has an independently measured 22px dark body on Chromium.
    const direct=document.createElement('canvas');direct.width=100;direct.height=100;
    const dc=direct.getContext('2d')!;dc.fillStyle='#fff';dc.fillRect(0,0,100,100);dc.fillStyle='#000';dc.font='bold 30px sans-serif';dc.fillText('E',20,50);
    const pixels=dc.getImageData(0,0,100,100).data;let top=100,bottom=-1;
    for(let y=0;y<100;y++)for(let x=0;x<100;x++)if(pixels[(y*100+x)*4]<80){top=Math.min(top,y);bottom=Math.max(bottom,y);}
    const originalBody=bottom-top+1,error=Math.abs(sourceBody-originalBody);
    check(error/originalBody<=.1||error<1,`deskew body error ${mode}: ${originalBody} vs ${sourceBody}`);
    check(Math.abs(outputBody-sourceBody)/sourceBody<=.1,`font calibration ${mode}`);
    rows.push({mode,zoom,originalBody,sourceBody,outputBody,error,writingMode:sizing.evidence.writingMode,space:sizing.space?.quality});
  }
  const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#996644';ctx.fillRect(0,0,200,100);ctx.fillStyle='#dd3311';ctx.strokeStyle='#000';ctx.lineWidth=5;ctx.font='bold 30px sans-serif';ctx.strokeText('BOOM',20,55);ctx.fillText('BOOM',20,55);
  const image=new Image();image.src=canvas.toDataURL();await image.decode();const bubble:TranslatedBubble={box:[1,1,999,999],original_text:'BOOM',t:'เสียง'};
  await prepareNewSourceSizing([bubble],image,'sans-serif');
  check(bubble.sourceSizing?.status==='fallback','artwork SFX must remain uncertain');

  // Safe-layout renderer acceptance with the real overlay, real fonts and the
  // prepared evidence. Translation words never share a line inside the 72px
  // column, so line count and 1.30 line spacing stay deterministic.
  const overlayRows: Record<string,unknown>[]=[];
  const decodeImage=async(src:string)=>{const i=new Image();i.src=src;await i.decode();return i;};
  const balloon=(closed:boolean)=>{const size=300,c=document.createElement('canvas');c.width=size;c.height=size;
    const g=c.getContext('2d')!;g.fillStyle='#fff';g.fillRect(0,0,size,size);g.fillStyle='#000';
    if(closed){g.fillRect(0,0,size,4);g.fillRect(0,size-4,size,4);g.fillRect(0,0,4,size);g.fillRect(size-4,0,4,size);}
    g.font='bold 30px sans-serif';for(let n=0;n<5;n++)g.fillText('E',140,50+n*45);
    return c.toDataURL();};
  const frameOf=(page:HTMLElement)=>page.querySelector<HTMLElement>('.translation-bubble-wrapper')!;
  const renderOverlay=async(b:TranslatedBubble,containerId:string,src:string,zoom=1)=>{
    const page=document.createElement('div');page.id=containerId;
    page.style.cssText='position:relative;width:300px;height:300px;';
    if(zoom!==1){page.style.transform=`scale(${zoom})`;page.style.transformOrigin='top left';}
    document.body.appendChild(page);
    page.appendChild(await decodeImage(src));
    await applyTranslationOverlay([b],'single',0,()=>{},undefined,
      {current:{fontFamily:'sans-serif',textColor:'#000000',textOutline:'#FFFFFF',fontSizeMultiplier:1}},page,containerId,undefined,'en');
    await new Promise(r=>setTimeout(r,400));
    return page;};
  const geometry=(frame:HTMLElement)=>({left:parseFloat(frame.style.left),top:parseFloat(frame.style.top),
    width:parseFloat(frame.style.width),height:parseFloat(frame.style.height)});
  const fontPxOf=(frame:HTMLElement)=>{const canvas=frame.querySelector('canvas')!;
    return parseFloat((canvas.getContext('2d')!.font.match(/([\d.]+)px/))?.[1]??'0');};
  // OCR box px: x 114..186, y 15..235.5 around the E column at x 140..161.
  const box:[number,number,number,number]=[50,380,785,620];
  const openSrc=balloon(false);
  const unknown:TranslatedBubble={box,original_text:'EEEEE',
    t:'one two four go ten her one two four go ten her'};
  await prepareNewSourceSizing([unknown],await decodeImage(openSrc),'sans-serif');
  check(unknown.sourceSizing?.status==='matched','unknown-space overlay case must stay matched');
  check(unknown.sourceSizing?.space?.quality==='unreliable','unbounded white balloon must keep space unknown');
  const unknownPage=await renderOverlay(unknown,'overlay-unknown-space',openSrc);
  const unknownFrame=frameOf(unknownPage),unknownBox=geometry(unknownFrame);
  // Unknown boundaries: the original OCR box is retained exactly, nothing
  // autoexpands or recenters, and the overflow is signalled while the matched
  // size stays visible.
  check(Math.abs(unknownBox.left-38)<0.01&&Math.abs(unknownBox.top-5)<0.01&&
    Math.abs(unknownBox.width-24)<0.01&&Math.abs(unknownBox.height-73.5)<0.01,
    `unknown space must retain the original box: ${JSON.stringify(unknownBox)}`);
  check(unknownFrame.dataset.layoutOverflow==='true','unknown space must signal visible overflow');
  check(Math.abs(fontPxOf(unknownFrame)-(unknown.sourceSizing?.baseFontSizePx??0))<0.5,
    `matched size must survive unknown space: ${fontPxOf(unknownFrame)} vs ${unknown.sourceSizing?.baseFontSizePx}`);
  overlayRows.push({case:'overlay-unknown-space',...unknownBox,overflow:true,
    fontPx:fontPxOf(unknownFrame),baseFontSizePx:unknown.sourceSizing?.baseFontSizePx});

  const closedSrc=balloon(true);
  const closed:TranslatedBubble={box,original_text:'EEEEE',t:'one two four go ten her'};
  await prepareNewSourceSizing([closed],await decodeImage(closedSrc),'sans-serif');
  check(closed.sourceSizing?.status==='matched','closed-space overlay case must stay matched');
  const spaceRect=closed.sourceSizing?.space?.rect;
  check(closed.sourceSizing?.space?.quality==='reliable'&&!!spaceRect,'bordered white balloon must yield reliable space');
  const closedPage=await renderOverlay(closed,'overlay-closed-space',closedSrc);
  const closedFrame=frameOf(closedPage),closedBox=geometry(closedFrame);
  // Trustworthy closed space: same x/y/width, height grows but the grown frame
  // stays inside the inscribed original space.
  check(Math.abs(closedBox.left-38)<0.01&&Math.abs(closedBox.top-5)<0.01&&Math.abs(closedBox.width-24)<0.01,
    `closed space must preserve x/y/width: ${JSON.stringify(closedBox)}`);
  check(closedBox.height>73.5,'closed space must allow contained height growth');
  check((closedBox.top+closedBox.height)*3<=spaceRect!.y+spaceRect!.height+0.5,
    `grown frame must stay inside the closed space: ${JSON.stringify(closedBox)} vs ${JSON.stringify(spaceRect)}`);
  check(Math.abs(fontPxOf(closedFrame)-(closed.sourceSizing?.baseFontSizePx??0))<0.5,
    `matched size must survive contained growth: ${fontPxOf(closedFrame)} vs ${closed.sourceSizing?.baseFontSizePx}`);
  overlayRows.push({case:'overlay-closed-space',...closedBox,
    fontPx:fontPxOf(closedFrame),baseFontSizePx:closed.sourceSizing?.baseFontSizePx,space:spaceRect});

  // Line structure on the overlay's own canvas: six whole-word lines at the
  // full 1.30 spacing, never a silently squeezed block. Alpha threshold stays
  // below glyph cores even when the sampled style profile lowers opacity.
  const textCanvas=closedFrame.querySelector('canvas')!;
  const textData=textCanvas.getContext('2d')!.getImageData(0,0,textCanvas.width,textCanvas.height).data;
  const bands:number[]=[];let lastInk=-1;
  for(let y=0;y<textCanvas.height;y++){let ink=false;
    for(let x=0;x<textCanvas.width;x++){if(textData[(y*textCanvas.width+x)*4+3]>60){ink=true;break;}}
    if(ink){if(lastInk<0||y-lastInk>4)bands.push(y);lastInk=y;}}
  check(bands.length===6,`overlay canvas must render six whole-word lines, saw ${bands.length}: starts ${JSON.stringify(bands)} spans ${JSON.stringify(bands.map((v,i)=>i<bands.length-1?bands[i+1]-v:'end'))}`);
  const gaps:number[]=[];for(let n=1;n<bands.length;n++)gaps.push(bands[n]-bands[n-1]);
  const lineSpacing=gaps.sort((a,b)=>a-b)[Math.floor(gaps.length/2)]??0;
  check(Math.abs(lineSpacing-(closed.targetFontSize??0)*1.30)<5,
    `lines must keep full 1.30 spacing instead of squeezing: ${lineSpacing}`);

  // Export: the exported raster must embed the translated text, measured as
  // added dark pixels beside the original pixels inside the frame strips that
  // do not contain the source E column.
  const exported=downloadTranslatedImage('offscreen',0,'',true,closedPage);
  check(typeof exported==='string'&&exported.startsWith('data:image/jpeg'),'overlay export must produce an image data url');
  const darkIn=async(src:string)=>{const c=document.createElement('canvas');c.width=300;c.height=300;
    const g=c.getContext('2d')!;g.drawImage(await decodeImage(src),0,0);const d=g.getImageData(0,0,300,300).data;
    let dark=0;for(let y=15;y<281;y++)for(let x=114;x<186;x++){if(x>=137&&x<162)continue;
      if(d[(y*300+x)*4]<80)dark++;}
    return dark;};
  const addedDark=await darkIn(exported as string)-await darkIn(closedSrc);
  check(addedDark>1000,`export must embed the translated text: added dark pixels ${addedDark}`);
  overlayRows.push({case:'overlay-export',lineBands:bands.length,lineSpacing,addedDark});

  // Reopen from persisted JSON at 0.44 presentation zoom: identical layout,
  // identical calibrated font and preserved whole-word translation.
  const reopened:TranslatedBubble=JSON.parse(JSON.stringify(closed));
  check(reopened.t===closed.t,'reopen must preserve the translation text');
  const reopenedPage=await renderOverlay(reopened,'overlay-reopen-zoom-0.44',closedSrc,0.44);
  const reopenedBox=geometry(frameOf(reopenedPage));
  check(Math.abs(reopenedBox.left-closedBox.left)<0.01&&Math.abs(reopenedBox.top-closedBox.top)<0.01&&
    Math.abs(reopenedBox.width-closedBox.width)<0.01&&Math.abs(reopenedBox.height-closedBox.height)<0.01,
    `reopen must reproduce the layout: ${JSON.stringify(reopenedBox)} vs ${JSON.stringify(closedBox)}`);
  check(Math.abs(fontPxOf(frameOf(reopenedPage))-(reopened.sourceSizing?.baseFontSizePx??0))<0.5,
    'reopen must keep the calibrated size');
  overlayRows.push({case:'overlay-reopen-zoom-0.44',...reopenedBox,fontPx:fontPxOf(frameOf(reopenedPage))});

  return {ok:true,rows,overlayRows,uncertainty:bubble.sourceSizing?.evidence.reason};
}
(window as unknown as {sourceSizeCheck:Promise<unknown>}).sourceSizeCheck=run().catch(error=>({ok:false,error:String(error),stack:error?.stack}));
