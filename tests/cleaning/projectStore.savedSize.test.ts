import 'fake-indexeddb/auto';
import { expect,test } from 'vitest';
import {clearProjectSession,saveProjectSession,loadProjectSession,appendPageToProjectSession} from '@/lib/projectStore';
import {createPageTargetIdentity} from '@/lib/translation/pageEligibility';
import {manualSourceSizing} from '@/lib/sourceTextSize';
import type {TranslatedBubble} from '@/lib/translationOverlay';

test('real saved reload preserves manual ownership, unmeasured evidence, layout, and drops evicted raster',async()=>{
  await clearProjectSession();
  const url='data:image/png;base64,c291cmNl';
  const bubble:TranslatedBubble={box:[0,0,100,100],t:'สวัสดี',targetFontSize:13.7,fontSizeMultiplier:1.25,
    sourceSizing:manualSourceSizing(undefined,[0,0,100,100]),
    userTextSpace:{owner:'manual',rect:{x:10,y:20,width:100,height:50},imageWidth:1000,imageHeight:1200},
    layoutAdjustment:{bx:10,by:20,bw:100,bh:50,iw:1000,ih:1200,targetFontSize:13.7}};
  const session={pages:[{id:'s03',url,name:'source.png'}],currentPage:0,bubbleCache:new Map([[url,[bubble]]]),translatedImageCache:new Map([[url,'data:image/png;base64,cmFzdGVy']])};
  await saveProjectSession(session);
  session.translatedImageCache.clear();
  await saveProjectSession(session,{dirtyPageUrls:new Set([url])});
  const loaded=(await loadProjectSession())!;
  expect(loaded.bubbleCache.get(url)?.[0]).toMatchObject(bubble);
  expect(loaded.translatedImageCache.has(url)).toBe(false);
});
test('extension append preserves exact validated target identity and existing page identities',async()=>{
  await clearProjectSession();
  const first='data:image/png;base64,Zmlyc3Q=',second='data:image/png;base64,c2Vjb25k';
  const th=createPageTargetIdentity('th')!,ja=createPageTargetIdentity('ja')!;
  await saveProjectSession({pages:[{id:'existing',url:first,name:'first.png'}],currentPage:0,bubbleCache:new Map(),translatedImageCache:new Map(),pageTargetCache:new Map([[first,ja]])});
  await appendPageToProjectSession({pageUrl:second,bubbles:[{t:'สวัสดี'}],targetIdentity:th,sourceFingerprint:'a'.repeat(64)});
  const loaded=(await loadProjectSession())!;
  expect(loaded.pageTargetCache.get(second)).toEqual(th);
  expect(loaded.pageTargetCache.get(first)).toEqual(ja);
  expect(loaded.pages.find(page=>page.url===second)?.sourceFingerprint).toBe('a'.repeat(64));
});
