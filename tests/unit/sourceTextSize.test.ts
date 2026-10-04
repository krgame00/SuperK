import { describe, expect, test } from 'vitest';
import { analyzeSourceLetterSize, resolveSourceFontSize, measureOutputBodyMetric, SOURCE_SIZE_POLICY } from '@/lib/sourceTextSize';

function fixture(height = 12, lines = 2) {
  const width = 100, h = lines * (height + 10) + 10;
  const rgba = new Uint8ClampedArray(width * h * 4).fill(255);
  for (let line = 0; line < lines; line++) for (let glyph = 0; glyph < 6; glyph++) {
    const x = 10 + glyph * 13, y = 5 + line * (height + 10);
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < 7; dx++) {
      if (dx > 1 && dx < 5 && dy > 1 && dy < height - 2) continue;
      const offset = ((y + dy) * width + x + dx) * 4;
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
    }
  }
  return { width, height: h, rgba };
}
const identity = { sourceRevision: 'original-v1', regionKey: '10,20,30,40', rect: {x:10,y:20,width:100,height:54}, originalText: 'HELLO WORLD' };

describe('original visible letter sizing', () => {
  test('uses repeated original glyph bodies rather than multiline rectangle height', () => {
    const evidence = analyzeSourceLetterSize(fixture(), identity);
    expect(evidence.quality).toBe('reliable');
    expect(evidence.bodyHeightPx).toBe(12);
    expect(evidence.lineCount).toBe(2);
    expect(evidence.policyVersion).toBe(SOURCE_SIZE_POLICY);
    expect(evidence.sourceRevision).toBe('original-v1');
  });
  test('preserves reliably small letters instead of applying the readable floor', () => {
    const evidence = analyzeSourceLetterSize(fixture(5, 1), identity);
    const size = resolveSourceFontSize(evidence, { family:'Loaded Thai', textKey:'กิ่', referencePx:100, bodyHeightPx:100, loaded:true });
    expect(size.status).toBe('matched');
    expect(size.baseFontSizePx).toBe(5);
    expect(size.readabilityWarning).toBeTruthy();
  });
  test('maps actual loaded font visible body metrics, including Thai diacritics', () => {
    const evidence = analyzeSourceLetterSize(fixture(), identity);
    for (const bodyHeightPx of [72, 105]) {
      const size = resolveSourceFontSize(evidence, { family:'Actual font', textKey:'กิ่ABC', referencePx:100, bodyHeightPx, loaded:true });
      expect(size.baseFontSizePx! * bodyHeightPx / 100).toBeCloseTo(12, 5);
    }
  });
  test('unloaded or absent visible font metrics never claim a match', () => {
    const evidence = analyzeSourceLetterSize(fixture(), identity);
    expect(resolveSourceFontSize(evidence, {family:'font',textKey:'abc',referencePx:100,bodyHeightPx:75,loaded:false}).status).toBe('fallback');
    expect(resolveSourceFontSize(evidence, {family:'font',textKey:'abc',referencePx:100,bodyHeightPx:0,loaded:true}).fallbackLabel).toBe('ยังเทียบขนาดต้นฉบับไม่ได้');
    expect(resolveSourceFontSize({...evidence,confidence:0.2}, {family:'font',textKey:'abc',referencePx:100,bodyHeightPx:75,loaded:true}).status).toBe('fallback');
  });
  test('rejects blank, blurred, artwork and unsupported vertical evidence', () => {
    const blank = fixture(); blank.rgba.fill(255);
    expect(analyzeSourceLetterSize(blank, identity).quality).toBe('unreliable');
    const blurred = fixture(); for(let i=0;i<blurred.rgba.length;i+=4) if(blurred.rgba[i]===0) blurred.rgba[i]=blurred.rgba[i+1]=blurred.rgba[i+2]=170;
    expect(analyzeSourceLetterSize(blurred, identity).quality).toBe('unreliable');
    const art = fixture(); for(let y=0;y<art.height;y++) for(let x=0;x<15;x++) {const i=(y*art.width+x)*4; art.rgba[i]=art.rgba[i+1]=art.rgba[i+2]=0;}
    expect(analyzeSourceLetterSize(art, identity).quality).toBe('unreliable');
    expect(analyzeSourceLetterSize(fixture(), {...identity, writingMode:'vertical'}).quality).toBe('unreliable');
  });
  test('colored core with dark outline is uncertain rather than measuring its inflated contour', () => {
    const outlined=fixture();
    for(let line=0;line<2;line++) for(let glyph=0;glyph<6;glyph++) for(let y=7+line*22;y<15+line*22;y++) for(let x=12+glyph*13;x<15+glyph*13;x++) {
      const i=(y*outlined.width+x)*4;outlined.rgba[i]=200;outlined.rgba[i+1]=30;outlined.rgba[i+2]=30;
    }
    expect(analyzeSourceLetterSize(outlined,identity).quality).toBe('unreliable');
  });
  test('a pale separated shadow does not inflate source bodies', () => {
    const shadowed=fixture();
    for(let y=0;y<shadowed.height-2;y++) for(let x=shadowed.width-3;x>=0;x--) {
      const i=(y*shadowed.width+x)*4,j=((y+2)*shadowed.width+x+2)*4;
      if(shadowed.rgba[i]===0 && shadowed.rgba[j]===255) shadowed.rgba[j]=shadowed.rgba[j+1]=shadowed.rgba[j+2]=210;
    }
    expect(analyzeSourceLetterSize(shadowed,identity).bodyHeightPx).toBe(12);
  });
  test('a combining mark must stay with its Thai base when actual metrics are measured', () => {
    const seen:string[]=[];
    const ctx={font:'',measureText:(value:string)=>{seen.push(value);return {actualBoundingBoxAscent:value==='กิ่'?95:70,actualBoundingBoxDescent:5};}} as unknown as CanvasRenderingContext2D;
    const metric=measureOutputBodyMetric(ctx,'Loaded Thai','กิ่',true);
    expect(seen).toEqual(['กิ่']);
    expect(metric.bodyHeightPx).toBe(100);
  });
});
