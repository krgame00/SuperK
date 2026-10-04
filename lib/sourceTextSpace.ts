import type { PixelRect } from './colorMatching/canvasSampler';
import type { ColorSampleRegion } from './colorMatching/types';

export const SOURCE_SPACE_POLICY='closed-white-inscribed-v1';
export interface SourceTextSpaceEvidence {
  policyVersion:string;
  sourceRevision:string;
  regionKey:string;
  contextKey?:string;
  quality:'reliable'|'unreliable';
  reason:string;
  rect?:PixelRect;
}
export function detectClosedSourceTextSpace(sample:ColorSampleRegion,seed:PixelRect,
  identity:{sourceRevision:string;regionKey:string},exclusions:PixelRect[]=[]):SourceTextSpaceEvidence {
  const fallback:SourceTextSpaceEvidence={...identity,policyVersion:SOURCE_SPACE_POLICY,quality:'unreliable',reason:'unknown-boundary'};
  const fail=(reason:string)=>({...fallback,reason});
  const {width,height,rgba}=sample;
  const valid=(r:PixelRect)=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
  if(!valid(seed)||width*height>2_000_000||rgba.length!==width*height*4) return fail('invalid-or-oversized-space');
  const left=Math.floor(seed.x)-2,right=Math.ceil(seed.x+seed.width)+2;
  const top=Math.floor(seed.y)-2,bottom=Math.ceil(seed.y+seed.height)+2;
  if(left<1||top<1||right>=width-1||bottom>=height-1) return fail('seed-at-image-edge');
  const white=(p:number)=>rgba[p*4+3]>=240&&rgba[p*4]>225&&rgba[p*4+1]>225&&rgba[p*4+2]>225;
  // Start outside the confirmed text. Never flood through a removal mask or
  // assume that the OCR rectangle itself marks a balloon boundary.
  const start=top*width+left;
  if(!white(start)) return fail('ambiguous-seed-surroundings');
  const visited=new Uint8Array(width*height),queue=[start];visited[start]=1;
  for(let head=0;head<queue.length;head++) {
    const p=queue[head],x=p%width,y=Math.floor(p/width);
    if(x===0||y===0||x===width-1||y===height-1) return fail('open-space-edge-leak');
    for(const n of [p-1,p+1,p-width,p+width]) if(!visited[n]&&white(n)) {visited[n]=1;queue.push(n);}
  }
  for(const other of exclusions) {
    if(!valid(other)) return fail('invalid-other-text-region');
    for(let y=Math.max(0,Math.floor(other.y));y<Math.min(height,Math.ceil(other.y+other.height));y++)
      for(let x=Math.max(0,Math.floor(other.x));x<Math.min(width,Math.ceil(other.x+other.width));x++)
        if(visited[y*width+x]) return fail('shared-space-with-other-text');
  }
  // Every row through the proposed strip must belong to the same enclosed
  // white component; only pixels inside the confirmed text seed are exempt.
  const rowSafe=(y:number)=>{
    for(let x=left;x<=right;x++) if(!visited[y*width+x]&&!(x>=seed.x&&x<seed.x+seed.width&&y>=seed.y&&y<seed.y+seed.height)) return false;
    return true;
  };
  for(let y=top;y<=bottom;y++) if(!rowSafe(y)) return fail('artwork-or-divided-space');
  let y0=top,y1=bottom;
  while(y0>1&&rowSafe(y0-1)) y0--;
  while(y1<height-2&&rowSafe(y1+1)) y1++;
  // Two pixels of interior clearance protect the border and antialias fringe.
  const rect={x:left+1,y:y0+2,width:right-left-1,height:y1-y0-3};
  if(rect.y>seed.y||rect.y+rect.height<seed.y+seed.height) return fail('insufficient-inscribed-space');
  return {...fallback,quality:'reliable',reason:'closed-white-inscribed-space',rect};
}
export function constrainSourceLayoutHeight(existing:PixelRect,requestedHeight:number,
  evidence?:SourceTextSpaceEvidence,explicitUserSpace?:PixelRect,currentNeighbors:PixelRect[]=[]):PixelRect & {overflow:boolean} {
  const space=explicitUserSpace??(evidence?.quality==='reliable'&&evidence.policyVersion===SOURCE_SPACE_POLICY?evidence.rect:undefined);
  const contained=space&&[space.x,space.y,space.width,space.height].every(Number.isFinite)&&
    existing.x>=space.x&&existing.x+existing.width<=space.x+space.width&&existing.y>=space.y&&existing.y+existing.height<=space.y+space.height;
  let limit=contained?space.y+space.height-existing.y:existing.height;
  // Current translated layouts can differ from original OCR positions. These
  // inexpensive rectangles are supplied by the renderer; no pixels are read.
  for(const neighbor of currentNeighbors) {
    if(![neighbor.x,neighbor.y,neighbor.width,neighbor.height].every(Number.isFinite)) {limit=existing.height;break;}
    if(neighbor.x<existing.x+existing.width&&neighbor.x+neighbor.width>existing.x&&neighbor.y+neighbor.height>existing.y)
      limit=Math.min(limit,Math.max(existing.height,neighbor.y-existing.y));
  }
  const requested=Number.isFinite(requestedHeight)?requestedHeight:existing.height;
  const height=Math.max(existing.height,Math.min(requested,limit));
  return {...existing,height,overflow:requested>height};
}
