import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import * as policy from '@/lib/extension/strictParity';
import {withReviewIdentity} from '@/lib/translation/qualityReview';
import {inspectedBackgroundEvidence} from '../helpers/extensionBackgroundEvidence';
afterEach(()=>{document.body.innerHTML='';delete (globalThis as any).__superKLoaded;vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it('reader rejects malicious update without deleting previous reading copy',()=>{
 vi.useFakeTimers();let listener:any;vi.stubGlobal('SuperKPolicy',policy);vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:any)=>listener=fn}},storage:{local:{set:vi.fn(async()=>{})}}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(new Proxy({},{get:()=>vi.fn(()=>({width:10}))}) as any);
 document.body.innerHTML='<img src="https://manga.test/a.png">';const img=document.querySelector('img')!;vi.spyOn(img,'getBoundingClientRect').mockReturnValue({top:0,left:0,width:600,height:900} as DOMRect);window.eval(readFileSync('chrome-extension/content.js','utf8'));
 const t='ไทย';const sourceRevision='a'.repeat(64);const good={action:'TRANSLATION_SUCCESS',imageUrl:img.src,cleanMode:'stroke',sourceRevision,targetIdentity:policy.createPageTargetIdentity('th'),...inspectedBackgroundEvidence(sourceRevision),bubbles:[{t,box:[0,0,100,100],original_text:'source',translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:t},'th',sourceRevision)}]};
 listener(good);expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);
 const snapshot={text:t,fontFamily:"'Itim', 'FC Subject', sans-serif",globalMult:1,bubbleMult:1,fontSizePx:20,lineHeightPx:24,frameWidthPx:60,frameHeightPx:90};
 for (const [target, multiline, lines] of [['th', 'ไทย\nไทย', ['ไทย','ไทย']], ['th', 'ไทย ไทย', ['ไทย','ไทย']], ['en', 'hello world', ['hello','world']]] as const) {
 listener({...good,targetIdentity:policy.createPageTargetIdentity(target),bubbles:[{...good.bubbles[0],t:multiline,translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:multiline},target,sourceRevision),layoutSnapshot:{...snapshot,text:multiline,lines}}]});
 expect(document.querySelector<HTMLElement>('.superk-text-bubble')?.style.fontSize).toBe('20px');
 expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(lines.join('\n'));
 }
 listener(good);
 for(const lines of [['ABC'],[42],['ไทยเพิ่ม']]){
  listener({...good,bubbles:[{...good.bubbles[0],layoutSnapshot:{...snapshot,lines}}]});
  expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);
 }
 listener({...good,bubbles:[{...good.bubbles[0],t:'',translated:'ABC',translationReview:withReviewIdentity({status:'accepted',sourceText:'source',reviewedText:'ABC'},'th','a'.repeat(64))}]});expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);
 listener({...good,bubbles:[{...good.bubbles[0],original_text:42}]});expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);
 listener({...good,bubbles:[{...good.bubbles[0],t:'ไทย𐐀'}]});expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);expect(document.querySelector('.superk-error')).not.toBeNull();
});
