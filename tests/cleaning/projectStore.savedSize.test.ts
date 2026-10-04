import 'fake-indexeddb/auto';
import { expect,test } from 'vitest';
import {clearProjectSession,saveProjectSession,loadProjectSession} from '@/lib/projectStore';
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
