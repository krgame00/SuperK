import type { PixelRect } from './colorMatching/canvasSampler';
import type { ColorSampleRegion } from './colorMatching/types';
import type { SourceTextSpaceEvidence } from './sourceTextSpace';

export const SOURCE_SIZE_POLICY = 'original-body-direction-v2';
export const SOURCE_SIZE_FALLBACK_LABEL = 'ยังเทียบขนาดต้นฉบับไม่ได้';
export interface SourceSizeEvidence {
  policyVersion: string;
  sourceRevision: string;
  regionKey: string;
  rect: PixelRect;
  pixelRevision: string;
  quality: 'reliable' | 'unreliable';
  confidence: number;
  reason: string;
  bodyHeightPx?: number;
  glyphCount: number;
  lineCount: number;
  writingMode?: 'horizontal' | 'vertical';
  rotation?: number;
}
export interface OutputBodyMetric {
  family: string;
  textKey: string;
  referencePx: number;
  bodyHeightPx: number;
  loaded: boolean;
  reliable?: boolean;
  reason?: string;
  matchedFontSizePx?: number;
}
export interface SourceSizing {
  mode: 'auto' | 'manual';
  status: 'matched' | 'fallback';
  evidence: SourceSizeEvidence;
  font?: OutputBodyMetric;
  baseFontSizePx?: number;
  readabilityWarning?: string;
  fallbackLabel?: string;
  space?: SourceTextSpaceEvidence;
  /** Preparation cache identity for source transcript and direction hints. */
  sourceInputKey?: string;
}
export const sourceRegionKey = (box?: number[]): string =>
  box?.length === 4 && box.every(Number.isFinite) ? box.join(',') : 'missing';

/** Content identity: pixels, rather than a temporary object URL, identify evidence. */
export function sourcePixelRevision(rgba: Uint8ClampedArray, width: number, height: number): string {
  let hash = 2166136261;
  for (let i = 0; i < rgba.length; i++) hash = Math.imul(hash ^ rgba[i], 16777619);
  return `${width}x${height}:${(hash >>> 0).toString(16)}`;
}
const median = (values: number[]): number => [...values].sort((a,b)=>a-b)[Math.floor(values.length / 2)];

/** Conservative separated lettering policy. No OCR rectangle size or removal mask is a size estimate. */
export function analyzeSourceLetterSize(
  sample: ColorSampleRegion,
  identity: {sourceRevision: string; regionKey: string; rect: PixelRect; originalText?: string; writingMode?: string; rotation?: number},
): SourceSizeEvidence {
  const evidence: SourceSizeEvidence = {
    policyVersion: SOURCE_SIZE_POLICY, sourceRevision: identity.sourceRevision,
    regionKey: identity.regionKey, rect: {...identity.rect},
    pixelRevision: sourcePixelRevision(sample.rgba, sample.width, sample.height),
    quality:'unreliable',confidence:0,reason:'insufficient-glyph-evidence',glyphCount:0,lineCount:0,
  };
  const fail = (reason:string) => ({...evidence,reason});
  const {width,height,rgba} = sample;
  if (!identity.originalText?.trim() || width < 3 || height < 3 || rgba.length !== width*height*4 || width*height > 2_000_000) return fail('missing-or-oversized-evidence');
  if (!Number.isFinite(identity.rotation ?? 0)) return fail('unsupported-direction');
  const angle=(identity.rotation ?? 0)%360;
  if(Math.abs(angle)>2) {
    // A known source angle is required. Deskew original pixels only during preparation.
    // White padding is not evidence: reject dark content clipped by the original crop.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) if(x===0||y===0||x===width-1||y===height-1) {
      const i=(y*width+x)*4;if(rgba[i]<225||rgba[i+1]<225||rgba[i+2]<225) return fail('clipped-glyphs-or-artwork');
    }
    const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
    const w=Math.ceil(Math.abs(width*c)+Math.abs(height*s))+4,h=Math.ceil(Math.abs(width*s)+Math.abs(height*c))+4;
    if(w*h>2_000_000) return fail('missing-or-oversized-evidence');
    const pixels=new Uint8ClampedArray(w*h*4).fill(255);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const dx=x-(w-1)/2,dy=y-(h-1)/2;
      const sx=Math.round(c*dx-s*dy+(width-1)/2),sy=Math.round(s*dx+c*dy+(height-1)/2);
      if(sx>=0&&sx<width&&sy>=0&&sy<height) pixels.set(rgba.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),(y*w+x)*4);
    }
    const result=analyzeSourceLetterSize({...sample,width:w,height:h,rgba:pixels},{...identity,rotation:0});
    return {...result,rect:evidence.rect,pixelRevision:evidence.pixelRevision,rotation:angle};
  }
  const ink = new Uint8Array(width*height);
  let dark = 0, white = 0, colored = 0, middle = 0;
  for(let p=0;p<ink.length;p++) {
    const i=p*4, r=rgba[i],g=rgba[i+1],b=rgba[i+2];
    if (rgba[i+3]<240) continue;
    if (Math.max(r,g,b)-Math.min(r,g,b)>25) colored++;
    const value=(r+g+b)/3;
    if(value<80) { ink[p]=1;dark++; }
    else if(value>225) white++;
    else middle++;
  }
  // Colored cores/contours, gray low-contrast print and busy backgrounds cannot
  // be distinguished safely from artwork under this first measurement policy.
  if(white/ink.length<0.65 || colored/ink.length>0.005 || !dark || middle>dark*1.5) return fail('ambiguous-background-or-effects');
  type Component = {x:number;y:number;w:number;h:number;area:number};
  const components: Component[]=[];
  const queue:number[]=[];
  for(let start=0;start<ink.length;start++) {
    if(!ink[start]) continue;
    ink[start]=0;queue.length=0;queue.push(start);
    let xmin=start%width,xmax=xmin,ymin=Math.floor(start/width),ymax=ymin;
    for(let head=0;head<queue.length;head++) {
      const p=queue[head],x=p%width,y=Math.floor(p/width);
      xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        const nx=x+dx,ny=y+dy;
        if(nx<0||nx>=width||ny<0||ny>=height) continue;
        const n=ny*width+nx;
        if(ink[n]) {ink[n]=0;queue.push(n);}
      }
    }
    if(queue.length>=3) components.push({x:xmin,y:ymin,w:xmax-xmin+1,h:ymax-ymin+1,area:queue.length});
  }
  if(components.some(c=>c.x===0||c.y===0||c.x+c.w===width||c.y+c.h===height)) return fail('clipped-glyphs-or-artwork');
  const bodies=components.filter(c=>c.h>=3 && c.w>=2 && c.w/c.h<1.5 && c.w/c.h>0.12 && c.area/(c.w*c.h)>=0.12);
  if(bodies.length<3) return fail('insufficient-separated-glyphs');
  const bodyHeight=median(bodies.map(c=>c.h));
  const regular=bodies.filter(c=>Math.abs(c.h-bodyHeight)<=Math.max(1,bodyHeight*0.15));
  if(regular.length/bodies.length<0.8 || regular.length<3) return fail('irregular-or-decorative-glyphs');
  const group=(vertical:boolean)=>{
  const rows:Component[][]=[];
  for(const c of [...regular].sort((a,b)=>a.y-b.y)) {
    const row=rows.find(r=>Math.abs(median(r.map(v=>vertical?v.x+v.w/2:v.y+v.h))-(vertical?c.x+c.w/2:c.y+c.h))<=Math.max(1,bodyHeight*0.2));
    if(row) row.push(c);else rows.push([c]);
  }
  return rows.some(row=>row.length<3 || Math.max(...row.map(c=>vertical?c.y+c.h:c.x+c.w))-Math.min(...row.map(c=>vertical?c.y:c.x))<bodyHeight*2)?undefined:rows;
  };
  let vertical=identity.writingMode==='vertical';
  let rows=group(vertical);
  if(!rows&&!identity.writingMode) {vertical=true;rows=group(true);}
  if(!rows) return fail('unsupported-direction-or-layout');
  // Detached marks are acceptable only close to an established body column.
  if(components.some(c=>!regular.includes(c) && !regular.some(body=>
    c.h<bodyHeight*0.5 && c.x<body.x+body.w && c.x+c.w>body.x && Math.abs(c.y-body.y)<bodyHeight*0.65))) return fail('unexplained-artwork-or-effects');
  return {...evidence,quality:'reliable',confidence:0.9,reason:`regular-high-contrast-${vertical?'vertical':'horizontal'}-glyphs`,bodyHeightPx:bodyHeight,glyphCount:regular.length,lineCount:rows.length,writingMode:vertical?'vertical':'horizontal',rotation:angle};
}

export function resolveSourceFontSize(evidence:SourceSizeEvidence, font:OutputBodyMetric): SourceSizing {
  if(evidence.policyVersion!==SOURCE_SIZE_POLICY || evidence.quality!=='reliable' || evidence.confidence<0.8 || !evidence.bodyHeightPx || !font.loaded || font.reliable===false || !Number.isFinite(font.bodyHeightPx) || font.bodyHeightPx<=0 || font.referencePx<=0) {
    return {mode:'auto',status:'fallback',evidence,font,fallbackLabel:SOURCE_SIZE_FALLBACK_LABEL};
  }
  const baseFontSizePx=font.matchedFontSizePx ?? evidence.bodyHeightPx*font.referencePx/font.bodyHeightPx;
  return {mode:'auto',status:'matched',evidence,font,baseFontSizePx,
    ...(baseFontSizePx<14 ? {readabilityWarning:'ข้อความต้นฉบับขนาดเล็ก อาจอ่านยาก'} : {})};
}

/** Use actual visible glyph metrics, including combining marks; outline/shadow are never drawn here. */
export function measureOutputBodyMetric(ctx:CanvasRenderingContext2D, family:string, text:string, loaded:boolean): OutputBodyMetric {
  const textKey=text.trim();
  const referencePx=100;
  ctx.font=`bold ${referencePx}px ${family}`;
  const segments=typeof Intl.Segmenter==='function'
    ? Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(textKey),p=>p.segment)
    : Array.from(textKey);
  const heights=segments.filter(s=>/[\p{L}\p{N}]/u.test(s)).map(s=>{
    const metrics=ctx.measureText(s);
    return metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent;
  }).filter(h=>Number.isFinite(h)&&h>0);
  return {family,textKey,referencePx,bodyHeightPx:heights.length?median(heights):0,loaded};
}

/** Bounded font-only raster probes account for small-size hinting and Thai marks.
 * Called only for preparation or changed font/text; never analyzes source pixels. */
export function calibrateOutputBodyMetric(ctx:CanvasRenderingContext2D, evidence:SourceSizeEvidence,
  family:string, text:string, loaded:boolean):OutputBodyMetric {
  const metric=measureOutputBodyMetric(ctx,family,text,loaded);
  if(!loaded || evidence.quality!=='reliable' || !evidence.bodyHeightPx || !metric.bodyHeightPx) return metric;
  const target=evidence.bodyHeightPx;
  const unavailable=()=>({...metric,reliable:false,reason:'font-raster-height-unavailable'});
  if(target>128) return unavailable();
  const segments=Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.trim()),p=>p.segment)
    .filter(s=>/[\p{L}\p{N}]/u.test(s));
  const sample=[...new Set(segments)].slice(0,8);
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const raster=canvas.getContext('2d',{willReadFrequently:true});
  if(!raster || !sample.length) return unavailable();
  let low=target*metric.referencePx/metric.bodyHeightPx*.4;
  let high=target*metric.referencePx/metric.bodyHeightPx*2;
  let best:OutputBodyMetric|undefined;
  try {
    for(let probe=0;probe<12;probe++) {
      const size=(low+high)/2,heights:number[]=[];
      for(const grapheme of sample) {
        raster.fillStyle='#fff';raster.fillRect(0,0,256,256);
        raster.font=`bold ${size}px ${family}`;raster.textAlign='center';raster.textBaseline='middle';
        raster.fillStyle='#000';raster.fillText(grapheme,128,128);
        const pixels=raster.getImageData(0,0,256,256).data;
        let top=256,bottom=-1;
        for(let y=0;y<256;y++)for(let x=0;x<256;x++) {
          const i=(y*256+x)*4;
          if(pixels[i]<80 && pixels[i+1]<80 && pixels[i+2]<80) {top=Math.min(top,y);bottom=Math.max(bottom,y);}
        }
        if(top===0||bottom===255) return unavailable();
        heights.push(bottom>=top?bottom-top+1:0);
      }
      const bodyHeightPx=median(heights);
      const candidate={...metric,referencePx:size,bodyHeightPx,matchedFontSizePx:size,reliable:true,reason:'loaded-font-visible-raster'};
      if(!best || Math.abs(bodyHeightPx-target)<Math.abs(best.bodyHeightPx-target)) best=candidate;
      if(bodyHeightPx===target) return candidate;
      if(bodyHeightPx<target) low=size;else high=size;
    }
    return best && Math.abs(best.bodyHeightPx-target)/target<=.1 ? best : unavailable();
  } catch { return unavailable(); }
  finally {canvas.width=0;canvas.height=0;}
}
