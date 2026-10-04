import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { clearProjectSession, loadProjectSession, saveProjectSession, appendPageToProjectSession } from "@/lib/projectStore";
import { createPageTargetIdentity } from "@/lib/translation/pageEligibility";
beforeEach(clearProjectSession);
it("persists target identities with stable page ids and remaps recovered URLs", async () => {
  const source="data:image/png;base64,c291cmNl";
  const target=createPageTargetIdentity("French")!;
  await saveProjectSession({pages:[{id:"stable",url:source,name:"page"}],currentPage:0,bubbleCache:new Map(),translatedImageCache:new Map(),pageTargetCache:new Map([[source,target]])});
  const restored=(await loadProjectSession())!;
  expect(restored.pageTargetCache.get(restored.pages[0].url)).toEqual(target);
  await saveProjectSession(restored);
  expect((await loadProjectSession())!.pageTargetCache.get(source)).toEqual(target);
});
it("preserves page identities when unrelated session saves or extension appends omit targets", async () => {
  const source="https://example.test/page.png";
  const data={pages:[{id:"page",url:source,name:"page"}],currentPage:0,bubbleCache:new Map(),translatedImageCache:new Map()};
  await saveProjectSession({...data,pageTargetCache:new Map([[source,createPageTargetIdentity("Thai")!]])});
  await saveProjectSession(data);
  await appendPageToProjectSession({pageUrl:"https://example.test/next.png"});
  const restored=(await loadProjectSession())!;
  expect(restored.pageTargetCache.get(source)?.targetId).toBe("th");
  expect(restored.pageTargetCache.has("https://example.test/next.png")).toBe(false);
});
it("keeps legacy targets missing and explicit target changes durable", async () => {
  const source="https://example.test/page.png";
  const data={pages:[{id:"page",url:source,name:"page"}],currentPage:0,bubbleCache:new Map(),translatedImageCache:new Map()};
  await saveProjectSession(data);
  expect((await loadProjectSession())!.pageTargetCache.size).toBe(0);
  await saveProjectSession({...data,pageTargetCache:new Map([[source,createPageTargetIdentity("Japanese")!]])});
  expect((await loadProjectSession())!.pageTargetCache.get(source)?.targetId).toBe("ja");
});
