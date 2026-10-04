import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import * as policy from '@/lib/extension/strictParity';
import {withReviewIdentity} from '@/lib/translation/qualityReview';
afterEach(()=>{document.body.innerHTML='';delete (globalThis as any).__superKLoaded;vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it('reader rejects malicious update without deleting previous reading copy',()=>{
 vi.useFakeTimers();let listener:any;vi.stubGlobal('SuperKPolicy',policy);vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:any)=>listener=fn}},storage:{local:{set:vi.fn(async()=>{})}}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(new Proxy({},{get:()=>vi.fn(()=>({width:10}))}) as any);
 document.body.innerHTML='<img src="https://manga.test/a.png">';const img=document.querySelector('img')!;vi.spyOn(img,'getBoundingClientRect').mockReturnValue({top:0,left:0,width:600,height:900} as DOMRect);window.eval(readFileSync('chrome-extension/content.js','utf8'));
 const t='ไทย';const good={action:'TRANSLATION_SUCCESS',imageUrl:img.src,cleanMode:'stroke',sourceRevision:'pixels',targetIdentity:policy.createPageTargetIdentity('th'),bubbles:[{t,box:[0,0,100,100],original_text:'source',translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:t},'th','pixels')}]};
 listener(good);expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);
 listener({...good,bubbles:[{...good.bubbles[0],t:'',translated:'ABC',translationReview:withReviewIdentity({status:'accepted',sourceText:'source',reviewedText:'ABC'},'th','pixels')}]});expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);
 listener({...good,bubbles:[{...good.bubbles[0],original_text:42}]});expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);
 listener({...good,bubbles:[{...good.bubbles[0],t:'ไทย𐐀'}]});expect(document.querySelector('.superk-text-bubble')?.textContent).toBe(t);expect(document.querySelector('.superk-error')).not.toBeNull();
});
