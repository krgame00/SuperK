import type { TranslatedBubble } from './translationOverlay';
import { normalizeBubbleBox, sampleBubbleRegionFromImageData } from './colorMatching/canvasSampler';
import { analyzeSourceLetterSize, calibrateOutputBodyMetric, resolveSourceFontSize, sourcePixelRevision, sourceRegionKey,
  SOURCE_SIZE_POLICY, SOURCE_SIZE_FALLBACK_LABEL, type SourceSizing, type SourceSizeEvidence } from './sourceTextSize';

/** Preparation only: original-image work is deliberately outside overlay/gesture rendering. */
export async function prepareNewSourceSizing(bubbles:TranslatedBubble[], image:HTMLImageElement, family:string):Promise<void> {
  const primary=family.split(',')[0].trim().replace(/^["']|["']$/g,'').toLowerCase();
  if(['itim','prompt','kanit','sarabun','mitr','chakra petch'].includes(primary)) {
    const registered=getComputedStyle(document.documentElement).getPropertyValue(`--font-${primary.replace(/ /g,'-')}`).trim();
    if(registered) family=registered;
  }
  const fresh=bubbles.filter(b=>b.sourceSizing?.mode==='auto' || (!b.sourceSizing && b.targetFontSize===undefined));
  if(!fresh.length) return;
  const width=image.naturalWidth||image.width||0,height=image.naturalHeight||image.height||0;
  let ctx:CanvasRenderingContext2D|null=null,rgba:Uint8ClampedArray|undefined;
  let revision='original-pixels-unavailable';
  let loaded=false;
  try {
    await document.fonts.load(`bold 100px ${family}`);
    loaded=typeof document.fonts.check==='function' && document.fonts.check(`bold 100px ${family}`);
  } catch { /* A failed load is a labeled fallback, never a precise match. */ }
  const canvas=document.createElement('canvas');
  try {
    // Bound original preparation allocations; no resampling can silently turn
    // source pixels into a nominal font-size estimate.
    if(width>0 && height>0 && width*height<=40_000_000) {
      canvas.width=width;canvas.height=height;
      ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(ctx) {
        ctx.drawImage(image,0,0,width,height);
        rgba=ctx.getImageData(0,0,width,height).data;
        revision=sourcePixelRevision(rgba,width,height);
      }
    }
    for(const bubble of fresh) {
      const rect=normalizeBubbleBox(bubble.box??[],width,height);
      const regionKey=sourceRegionKey(bubble.box);
      const previous=bubble.sourceSizing;
      const text=bubble.t||bubble.translated||'';
      if(previous?.evidence.sourceRevision===revision && previous.evidence.regionKey===regionKey &&
        previous.evidence.policyVersion===SOURCE_SIZE_POLICY && previous.font?.family===family &&
        previous.font.textKey===text.trim() && previous.font.loaded===loaded) continue;
      let evidence:SourceSizeEvidence={policyVersion:SOURCE_SIZE_POLICY,sourceRevision:revision,regionKey,rect,
        pixelRevision:'unavailable',quality:'unreliable',confidence:0,reason:'original-pixels-unavailable',glyphCount:0,lineCount:0};
      if(rgba && regionKey!=='missing' && !bubble.isInvalidBox) {
        evidence=analyzeSourceLetterSize(sampleBubbleRegionFromImageData(rgba,width,height,rect),{
          sourceRevision:revision,regionKey,rect,originalText:bubble.original_text,
          writingMode:typeof bubble.writingMode==='string'?bubble.writingMode:undefined,
          rotation:typeof bubble.sourceRotation==='number'?bubble.sourceRotation:0,
        });
      }
      const metric=ctx?calibrateOutputBodyMetric(ctx,evidence,family,bubble.t||bubble.translated||'',loaded):undefined;
      const sizing:SourceSizing=metric?resolveSourceFontSize(evidence,metric)
        :{mode:'auto',status:'fallback',evidence,fallbackLabel:SOURCE_SIZE_FALLBACK_LABEL};
      bubble.sourceSizing=sizing;
      if(sizing.status==='matched') bubble.targetFontSize=sizing.baseFontSizePx;
      else if(bubble.targetFontSize===previous?.baseFontSizePx) {
        delete bubble.targetFontSize;
        if(bubble.layoutAdjustment && bubble.layoutAdjustment.targetFontSize===previous?.baseFontSizePx) delete bubble.layoutAdjustment.targetFontSize;
      }
    }
  } catch {
    for(const bubble of fresh) {
      const previous=bubble.sourceSizing;
      if(previous?.baseFontSizePx!==undefined) {
        if(bubble.targetFontSize===previous.baseFontSizePx) delete bubble.targetFontSize;
        if(bubble.layoutAdjustment?.targetFontSize===previous.baseFontSizePx) delete bubble.layoutAdjustment.targetFontSize;
      }
      bubble.sourceSizing={mode:'auto',status:'fallback',fallbackLabel:SOURCE_SIZE_FALLBACK_LABEL,
        evidence:{policyVersion:SOURCE_SIZE_POLICY,sourceRevision:'original-pixels-unavailable',regionKey:sourceRegionKey(bubble.box),
          rect:normalizeBubbleBox(bubble.box??[],width,height),pixelRevision:'unavailable',quality:'unreliable',confidence:0,
          reason:'original-pixels-unavailable',glyphCount:0,lineCount:0}} satisfies SourceSizing;
    }
  } finally { canvas.width=0;canvas.height=0; }
}
