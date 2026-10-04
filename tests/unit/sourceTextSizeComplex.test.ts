import { expect, test } from 'vitest';
import { analyzeSourceLetterSize } from '@/lib/sourceTextSize';

const identity = { sourceRevision:'original', regionKey:'region', rect:{x:0,y:0,width:100,height:100}, originalText:'ABCDEF' };
function fixture(vertical=false) {
  const width=100,height=100,rgba=new Uint8ClampedArray(width*height*4).fill(255);
  for(let n=0;n<5;n++) for(let y=0;y<10;y++) for(let x=0;x<6;x++) {
    const px=10+(vertical?0:n*15)+x,py=10+(vertical?n*15:0)+y;
    if(x>1&&x<4&&y>1&&y<8) continue;
    const i=(py*width+px)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;
  }
  return {width,height,rgba};
}
test('vertical columns retain upright body height rather than column height',()=>{
  const result=analyzeSourceLetterSize(fixture(true),{...identity,writingMode:'vertical'});
  expect(result.quality).toBe('reliable');expect(result.bodyHeightPx).toBe(10);
  expect(result.lineCount).toBe(1);
});
test('absent direction metadata infers vertical from separated columns',()=>{
  const result=analyzeSourceLetterSize(fixture(true),identity);
  expect(result.quality).toBe('reliable');expect(result.writingMode).toBe('vertical');
  expect(result.bodyHeightPx).toBe(10);
});
test('explicit quarter-turn source recovers unrotated body height',()=>{
  const source=fixture(),rotated=fixture();rotated.rgba.fill(255);
  for(let y=0;y<100;y++)for(let x=0;x<100;x++) rotated.rgba.set(source.rgba.subarray((y*100+x)*4,(y*100+x)*4+4),(x*100+99-y)*4);
  const result=analyzeSourceLetterSize(rotated,{...identity,rotation:90});
  expect(result.quality).toBe('reliable');expect(result.bodyHeightPx).toBe(10);
});
test('plain caption and regular SFX can use evidence but artwork stays uncertain',()=>{
  expect(analyzeSourceLetterSize(fixture(),identity).quality).toBe('reliable');
  const art=fixture();for(let i=0;i<art.rgba.length;i+=4){if(art.rgba[i]===255){art.rgba[i]=170;art.rgba[i+1]=130;}}
  expect(analyzeSourceLetterSize(art,{...identity,writingMode:'vertical'}).quality).toBe('unreliable');
});
