import { expect, test } from 'vitest';
import { detectClosedSourceTextSpace, constrainSourceLayoutHeight } from '@/lib/sourceTextSpace';
const seed={x:30,y:30,width:20,height:10};
function fixture(gap=false) {
  const width=100,height=100,rgba=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=10;y<=80;y++)for(let x=10;x<=80;x++) if((x===10||x===80||y===10||y===80)&&!(gap&&y===10&&x===40)) {
    const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;
  }
  return {width,height,rgba};
}
const identity={sourceRevision:'original',regionKey:'region'};
test('closed original white space yields an inscribed available rectangle',()=>{
  const result=detectClosedSourceTextSpace(fixture(),seed,identity);
  expect(result.quality).toBe('reliable');expect(result.rect!.y).toBeGreaterThan(10);
  expect(result.rect!.y+result.rect!.height).toBeLessThan(80);
  expect(constrainSourceLayoutHeight(seed,60,result).height).toBeGreaterThan(10);
});
test('edge leaks and another text region reject balloon evidence',()=>{
  expect(detectClosedSourceTextSpace(fixture(true),seed,identity).quality).toBe('unreliable');
  expect(detectClosedSourceTextSpace(fixture(),seed,identity,[{x:40,y:60,width:10,height:10}]).quality).toBe('unreliable');
});
test('unknown boundaries retain width, height, position and report overflow',()=>{
  expect(constrainSourceLayoutHeight(seed,90)).toEqual({...seed,overflow:true});
});
test('explicit user space authorizes only its contained height',()=>{
  const result=constrainSourceLayoutHeight(seed,90,undefined,{x:20,y:20,width:40,height:50});
  expect(result).toEqual({...seed,height:40,overflow:true});
});
test('current moved neighbor layout caps automatic growth inside admitted space',()=>{
  const result=constrainSourceLayoutHeight(seed,90,undefined,{x:20,y:20,width:40,height:70},[{x:25,y:55,width:30,height:10}]);
  expect(result).toEqual({...seed,height:25,overflow:true});
});
