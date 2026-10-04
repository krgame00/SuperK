import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { useCleaning } from "@/hooks/useCleaning";
import { useTranslation } from "@/hooks/useTranslation";
import WorkspacePage from "@/src/app/page";
import { scanPageGeometry } from "@/lib/export/readabilityScan";
import { downloadTranslatedImage, applyTranslationOverlay } from "@/lib/translationOverlay";
import { inspectBackgroundRemnants } from "@/lib/cleaning/backgroundRemnantInspection";
import { LANGUAGE_POLICY_VERSION } from "@/lib/languagePolicy";
import { withReviewIdentity } from "@/lib/translation/qualityReview";

vi.mock("@/hooks/useCleaning");
vi.mock("@/hooks/useTranslation");
vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(),
  downloadTranslatedImage: vi.fn(),
}));
vi.mock("@/lib/export/readabilityScan", () => ({ scanPageGeometry: vi.fn() }));
vi.mock("@/components/cleaning/MaskLegend", () => ({ MaskLegend: () => null }));
vi.mock("@/components/cleaning/CleaningToolbar", () => ({
  CleaningToolbar: vi.fn(({ hasTranslated, layer, onClean, onEditMask, onLayerChange }: ComponentProps<typeof import("@/components/cleaning/CleaningToolbar").CleaningToolbar>) => (
    <section aria-label="Cleaning toolbar" data-has-translated={String(hasTranslated)} data-layer={layer}>
      <button type="button" onClick={onClean}>Clean current page</button>
      <button type="button" onClick={onEditMask}>Edit mask</button>
      {(["original", "clean", "translated", "mask"] as const).map((nextLayer) => (
        <button key={nextLayer} type="button" onClick={() => onLayerChange(nextLayer)}
          disabled={nextLayer === "translated" && !hasTranslated}>
          Layer {nextLayer}
        </button>
      ))}
    </section>
  )),
}));
vi.mock("@/components/cleaning/MaskEditor", () => ({
  MaskEditor: vi.fn(() => <div role="dialog" aria-label="Mask editor" />),
}));
vi.mock("@/lib/export/saveLocation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/export/saveLocation")>(),
  saveBlob: vi.fn().mockImplementation(async (_blob, name) => name),
}));

const PAGE_ONE_URL = "data:image/png;base64,cGFnZU9uZQ=="; // "pageOne"
const PAGE_TWO_URL = "data:image/png;base64,cGFnZVR3bw=="; // "pageTwo"
const STALE_RENDER_URL = "data:image/png;base64,U1RBTEU="; // "STALE"
const PAGE_ONE_NAME = "page-one.png";

const cleaningResult = {
  sourceFingerprint: "src-1",
  width: 100,
  height: 100,
  pageId: PAGE_ONE_URL,
  cleanUrl: "data:image/png;base64,Q0xFQU4=",
  maskUrl: "data:image/png;base64,TUFTSw==",
  reviewMaskUrl: "data:image/png;base64,UkVWSUVX",
  protectedMaskUrl: "data:image/png;base64,UFJPVEVDVEVE",
  diffUrl: "data:image/png;base64,RElGRg==",
  regions: [],
};

/** Old accepted snapshot that exactly matches the contaminated raw text — the pre-G04 bypass state. */
const oldAcceptedContaminated = () => ({
  box: [0, 0, 100, 100],
  t: "รอก่อนא",
  original_text: "Wait.",
  translationReview: withReviewIdentity({ status: "accepted" as const, sourceText: "Wait.", reviewedText: "รอก่อนא" }, "th", "src-1"),
});
const cleanVerified = (text = "รอก่อน", source = "Wait.") => ({
  box: [0, 0, 100, 100],
  t: text,
  original_text: source,
  translationReview: withReviewIdentity({ status: "accepted" as const, sourceText: source, reviewedText: text }, "th", "src-1"),
});

let translationMockState: Record<string, unknown>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(downloadTranslatedImage).mockReset();
  vi.mocked(applyTranslationOverlay).mockReset();
  vi.mocked(applyTranslationOverlay).mockImplementation((...args) => { args[4]?.("data:image/png;base64,UkVOREVSRUQ="); return true as never; });
  const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function(this: HTMLImageElement, url) { imageSrc.set?.call(this, url); if (this.id === "offscreen-image") queueMicrotask(() => this.dispatchEvent(new Event("load"))); });
  translationMockState = {
    targetLang: "Thai",
    setTargetLang: vi.fn(),
    pageTargetCacheRef: { current: new Map([PAGE_ONE_URL, PAGE_TWO_URL].map(url => [url, {targetId:"th", policyVersion:LANGUAGE_POLICY_VERSION}])) },
    getPageTargetLanguage: vi.fn(() => "th"),
    sourceLang: "auto",
    setSourceLang: vi.fn(),
    modelPreference: "auto",
    setModelPreference: vi.fn(),
    allowPreviewModels: false,
    setAllowPreviewModels: vi.fn(),
    glossary: [],
    setGlossary: vi.fn(),
    textStyle: { fontFamily: "Itim, sans-serif", textColor: "#000000", textOutline: "#FFFFFF", fontSizeMultiplier: 1 },
    setTextStyle: vi.fn(),
    nsfwBypassMode: false,
    setNsfwBypassMode: vi.fn(),
    isTranslating: false,
    translationResult: null,
    setTranslationResult: vi.fn(),
    showTranslate: false,
    setShowTranslate: vi.fn(),
    handleTranslate: vi.fn().mockResolvedValue(true),
    isTranslatingAll: false,
    translateAllProgress: null,
    handleTranslateAll: vi.fn().mockResolvedValue(undefined),
    cancelTranslateAll: vi.fn(),
    translateCrop: vi.fn(),
    activeBubbles: [],
    setActiveBubbles: vi.fn(),
    translatedImages: new Map(),
    translatedImageCacheRef: { current: new Map() },
    bubbleCacheRef: { current: new Map() },
    textStyleRef: { current: {} },
    userApiKey: "",
    setUserApiKey: vi.fn(),
    restoreSavedSession: vi.fn().mockResolvedValue({
      pages: [{ url: PAGE_ONE_URL, name: PAGE_ONE_NAME }],
      currentPage: 0,
      bubbleCache: new Map(),
      translatedImageCache: new Map(),
    }),
    clearSavedSession: vi.fn(),
    saveStatus: "idle",
    saveError: null,
    retrySaveSession: vi.fn().mockResolvedValue(true),
    workflowPhase: null,
    batchFailures: [],
    failureGroups: [],
    retryFailedPages: vi.fn().mockResolvedValue(undefined),
    retryFailureGroup: vi.fn().mockResolvedValue(undefined),
    autoProceedOnReview: false,
    setAutoProceedOnReview: vi.fn(),
    reviewFlaggedPages: new Set(),
    invalidatePageTranslation: vi.fn(),
    refreshPageTranslation: vi.fn().mockResolvedValue(undefined),
    scanTranslatedPages: vi.fn(() => []),
    inspectTranslatedPages: vi.fn(() => []),
    replaceBubbleText: vi.fn(() => 0),
    getPageSignature: vi.fn(() => "rev-0"),
    getPageSourceRevision: vi.fn(() => "src-1"),
    getPageRevision: vi.fn(() => 0),
    cacheRevision: 0,
    inspectLegacyTargets: vi.fn(() => []),
    confirmLegacyTarget: vi.fn(() => 0),
    inspectReviewIssues: vi.fn(() => []),
    confirmPointReview: vi.fn(() => true),
    repairWholeBook: vi.fn().mockResolvedValue({ pagesRepaired: 0, pointsRepaired: 0, cancelled: false, unresolved: [], skipped: [] }),
    cancelWholeBookRepair: vi.fn(),
    isRepairingBook: false,
  };
  vi.mocked(useCleaning).mockReturnValue({
    getCurrentRemnantReview: vi.fn(() => ({ inspection: inspectBackgroundRemnants({revisions:{sourceRevision:"src-1",backgroundRevision:"bg-1",removalRevision:"rm-1"}, originalPlane:{width:1,height:1,data:new Uint8Array([255])},cleanPlane:{width:1,height:1,data:new Uint8Array([255])},removalRegions:[{id:"r",rect:{x:0,y:0,width:1,height:1},status:"ready"}]}) })),
    cleanPage: vi.fn().mockResolvedValue(cleaningResult),
    cleanCurrentPage: vi.fn().mockResolvedValue(cleaningResult),
    retryRegion: vi.fn().mockResolvedValue(cleaningResult),
    cancelPolling: vi.fn(),
    currentResult: cleaningResult,
    progress: undefined,
    error: undefined,
    resultsByPage: new Map([[PAGE_ONE_URL, cleaningResult], [PAGE_TWO_URL, cleaningResult]]),
  } as never);
  vi.mocked(useTranslation).mockReturnValue(translationMockState as never);
  vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ pairingToken: "tok" }),
    blob: vi.fn().mockResolvedValue(new Blob(["original"], { type: "image/png" })),
  }));
});

async function restoreWorkspaceWith(overrides: Record<string, unknown>) {
  Object.assign(translationMockState, overrides);
  const rendered = render(<WorkspacePage />);
  const restoreButton = await screen.findByRole("button", { name: /คืนค่างานเดิม/ });
  await act(async () => { fireEvent.click(restoreButton); });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /คืนค่างานเดิม/ })).not.toBeInTheDocument(),
  );
  return rendered;
}

async function requestExport(item: RegExp | string) {
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: item instanceof RegExp && item.source === "ZIP" ? /^ZIP$/ : item }));
}

async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

test("book export lists a script-failed page even with an old accepted snapshot, and cannot blanket-confirm it", async () => {
  await restoreWorkspaceWith({
    bubbleCacheRef: { current: new Map([[PAGE_ONE_URL, [oldAcceptedContaminated()]]]) },
  });
  await requestExport(/ZIP/);

  const notice = await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export");
  expect(notice).toBeTruthy();
  expect(screen.getByText(/ตัวอักษรภาษาอื่นปน 1 จุด/)).toBeTruthy();
  expect(screen.getAllByText(/ยืนยันผ่านไม่ได้/).length).toBeGreaterThan(0);
  const confirm = screen.getByRole("button", { name: "ยืนยันทุกหน้าและดำเนินการ Export" });
  expect(confirm).toBeDisabled();
  // No output escaped the gate.
  expect(vi.mocked(downloadTranslatedImage)).not.toHaveBeenCalled();
  const { saveBlob } = await import("@/lib/export/saveLocation");
  expect(saveBlob).not.toHaveBeenCalled();
});

test("the gate fires before any cached raster or live-canvas render is consulted", async () => {
  await restoreWorkspaceWith({
    bubbleCacheRef: { current: new Map([[PAGE_ONE_URL, [oldAcceptedContaminated()]]]) },
    translatedImageCacheRef: { current: new Map([[PAGE_ONE_URL, STALE_RENDER_URL]]) },
  });
  await requestExport("รูปภาพหน้านี้");

  expect(await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export")).toBeTruthy();
  expect(vi.mocked(downloadTranslatedImage)).not.toHaveBeenCalled();
  expect(vi.mocked(applyTranslationOverlay)).not.toHaveBeenCalled();
  const { saveBlob } = await import("@/lib/export/saveLocation");
  expect(saveBlob).not.toHaveBeenCalled();
});

test("an affected page can be explicitly substituted with its original image", async () => {
  await restoreWorkspaceWith({
    bubbleCacheRef: { current: new Map([[PAGE_ONE_URL, [oldAcceptedContaminated()]]]) },
  });
  await requestExport("รูปภาพหน้านี้");
  await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export");

  fireEvent.click(screen.getByRole("button", { name: "ส่งออกเป็นต้นฉบับ" }));
  // The affected page leaves the list; the pending export stays actionable.
  const { saveBlob } = await import("@/lib/export/saveLocation");
  const continueExport = await screen.findByRole("button", { name: "ดำเนินการ Export ต่อ" });
  const exportCompleted = new Promise<void>((resolve) => {
    vi.mocked(translationMockState.setTranslationResult as ReturnType<typeof vi.fn>).mockImplementation((message: unknown) => {
      if (typeof message === "string" && message.includes("บันทึก SuperK_Page_001_page-one.png สำเร็จ")) resolve();
    });
  });
  await act(async () => {
    fireEvent.click(continueExport);
    await exportCompleted;
  });
  await waitFor(() => expect(translationMockState.setTranslationResult).toHaveBeenCalledWith(expect.stringContaining("บันทึก SuperK_Page_001_page-one.png สำเร็จ")));
  const [blob, filename] = vi.mocked(saveBlob).mock.calls.at(-1)!;
  expect(filename).toBe("SuperK_Page_001_page-one.png");
  expect(new TextDecoder().decode(await readBlobBytes(blob as Blob))).toBe("pageOne");
  // Original bytes were exported, not a translated render.
  expect(vi.mocked(downloadTranslatedImage)).not.toHaveBeenCalled();
});

test("an affected page can be explicitly excluded from a book export while ordering and numbering are preserved", async () => {
  await restoreWorkspaceWith({
    bubbleCacheRef: { current: new Map([
      [PAGE_ONE_URL, [oldAcceptedContaminated()]],
      [PAGE_TWO_URL, [cleanVerified("หน้าสอง", "Second.")]],
    ]), },
    translatedImageCacheRef: { current: new Map([[PAGE_TWO_URL, "data:image/png;base64,cGFnZVR3bw=="]]) },
    restoreSavedSession: vi.fn().mockResolvedValue({
      pages: [
        { url: PAGE_ONE_URL, name: PAGE_ONE_NAME },
        { url: PAGE_TWO_URL, name: "page-two.png" },
      ],
      currentPage: 0,
      bubbleCache: new Map(),
      translatedImageCache: new Map(),
    }),
  });
  await requestExport(/ZIP/);
  await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export");

  fireEvent.click(screen.getByRole("button", { name: "ตัดหน้านี้ออก" }));
  fireEvent.click(await screen.findByRole("button", { name: "ดำเนินการ Export ต่อ" }));

  const { saveBlob } = await import("@/lib/export/saveLocation");
  await waitFor(() => expect(saveBlob).toHaveBeenCalled());
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readBlobBytes(vi.mocked(saveBlob).mock.calls.at(-1)![0] as Blob));
  expect(zip.file("SuperK_Page_001_page-one.png")).toBeNull();
  expect(await zip.file("SuperK_Page_002_page-two.png")!.async("string")).toBe("RENDERED");
  // The exclusion is reported, never silent.
  await waitFor(() =>
    expect(translationMockState.setTranslationResult).toHaveBeenCalledWith(expect.stringContaining("ตัด 1 หน้าออก")),
  );
});

test("missing review evidence blocks export and explicit per-point confirmation releases it", async () => {
  const unverified = { box: [0, 0, 100, 100], t: "พิมพ์เอง", original_text: "Typed." };
  const rendered = await restoreWorkspaceWith({
    bubbleCacheRef: { current: new Map([[PAGE_ONE_URL, [unverified]]]) },
  });
  await requestExport("รูปภาพหน้านี้");
  await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export");
  expect(screen.getByText(/ยังไม่ได้ตรวจกับต้นฉบับ 1 จุด/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "ยืนยันทุกหน้าและดำเนินการ Export" })).toBeDisabled();

  // The per-point confirmation (review dialog) mutates the bubble's review
  // evidence in place and bumps the hook's cache revision.
  (translationMockState.bubbleCacheRef as { current: Map<string, unknown[]> }).current
    .set(PAGE_ONE_URL, [cleanVerified("พิมพ์เอง", "Typed.")]);
  vi.mocked(useTranslation).mockReturnValue({
    ...translationMockState,
    cacheRevision: 1,
  } as never);
  rendered.rerender(<WorkspacePage />);
  vi.mocked(downloadTranslatedImage).mockReturnValue("data:image/png;base64,UkVOREVSRUQ=" as never);
  const { saveBlob } = await import("@/lib/export/saveLocation");
  const continueExport = await screen.findByRole("button", { name: "ดำเนินการ Export ต่อ" });
  const exportCompleted = new Promise<void>((resolve) => {
    vi.mocked(translationMockState.setTranslationResult as ReturnType<typeof vi.fn>).mockImplementation((message: unknown) => {
      if (typeof message === "string" && message.includes("บันทึก SuperK_Page_001_page-one.png สำเร็จ")) resolve();
    });
  });
  await act(async () => {
    fireEvent.click(continueExport);
    await exportCompleted;
  });
  await waitFor(() => expect(translationMockState.setTranslationResult).toHaveBeenCalledWith(expect.stringContaining("บันทึก SuperK_Page_001_page-one.png สำเร็จ")));
  expect(vi.mocked(saveBlob).mock.calls.at(-1)![1]).toBe("SuperK_Page_001_page-one.png");
});

test("publish-back to the reading view is gated by the same eligibility rule", async () => {
  const publishCalls: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/extension/publish-back")) {
      publishCalls.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ pairingToken: "tok" }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  const rendered = await restoreWorkspaceWith({
    bubbleCacheRef: { current: new Map([[PAGE_ONE_URL, [oldAcceptedContaminated()]]]) },
    restoreSavedSession: vi.fn().mockResolvedValue({
      pages: [{ url: PAGE_ONE_URL, name: PAGE_ONE_NAME, originUrl: "https://reader.example/page-1" }],
      currentPage: 0,
      bubbleCache: new Map(),
      translatedImageCache: new Map(),
    }),
  });

  const publishButton = screen.getAllByRole("button", { name: "ส่งคำแปลกลับไปยังหน้าอ่านบนเว็บ" })[0];
  fireEvent.click(publishButton);
  // Let the publish attempt settle (the button re-enables when it finishes).
  await waitFor(() => expect(publishButton).toBeEnabled());
  expect(publishCalls).toEqual([]);

  // After the text is repaired the same publication succeeds.
  vi.mocked(useTranslation).mockReturnValue({
    ...translationMockState,
    bubbleCacheRef: { current: new Map([[PAGE_ONE_URL, [cleanVerified()]]]) },
  } as never);
  rendered.rerender(<WorkspacePage />);
  const repairedButton = screen.getAllByRole("button", { name: "ส่งคำแปลกลับไปยังหน้าอ่านบนเว็บ" })[0];
  fireEvent.click(repairedButton);
  await waitFor(() => expect(publishCalls).toHaveLength(1));
  expect(publishCalls[0]).toMatchObject({ bubbles: [cleanVerified()], targetIdentity: {targetId:"th",policyVersion:LANGUAGE_POLICY_VERSION},sourceRevision:"src-1",backgroundState:"approved" });
});

test("publication rejects an accepted cache replacement during pairing", async () => {
 const cache = new Map([[PAGE_ONE_URL,[cleanVerified()]]]);
 let finishPairing!: (value: Response) => void;
 const fetchMock = vi.fn((input:RequestInfo|URL) => String(input).endsWith("/pair") ? new Promise<Response>(resolve => { finishPairing = resolve; }) : Promise.resolve({ok:true,json:async()=>({})} as Response));
 vi.stubGlobal("fetch",fetchMock);
 const failure = vi.spyOn(console,"error").mockImplementation(() => {});
 await restoreWorkspaceWith({bubbleCacheRef:{current:cache},restoreSavedSession:vi.fn().mockResolvedValue({pages:[{url:PAGE_ONE_URL,name:PAGE_ONE_NAME,originUrl:"https://reader.example/page-1"}],currentPage:0,bubbleCache:new Map(),translatedImageCache:new Map()})});
 await act(async () => { fireEvent.click(screen.getAllByRole("button",{name:"ส่งคำแปลกลับไปยังหน้าอ่านบนเว็บ"})[0]); });
 await waitFor(() => expect(finishPairing).toBeTypeOf("function"));
 await act(async () => { cache.set(PAGE_ONE_URL,[cleanVerified("รอก่อนนะ")]); finishPairing({ok:true,json:async()=>({pairingToken:"tok"})} as Response); });
 expect(fetchMock.mock.calls.some(([url])=>String(url).includes("publish-back"))).toBe(false);
 expect(failure).toHaveBeenCalledExactlyOnceWith("Failed to publish back to reading view:",expect.objectContaining({message:"หลักฐานเปลี่ยนระหว่างส่งกลับ กรุณาตรวจหน้าอีกครั้ง"}));
 failure.mockRestore();
});

test.each([false,true])("two strip chunks stage the whole book before release (mutation %s)", async (mutate) => {
 const cache = new Map([[PAGE_ONE_URL,[cleanVerified()]],[PAGE_TWO_URL,[cleanVerified()]]]);
 vi.spyOn(HTMLImageElement.prototype,"src","set").mockImplementation(function(this:HTMLImageElement,url){this.setAttribute("src",url);Object.defineProperties(this,{naturalWidth:{value:1200,configurable:true},naturalHeight:{value:8000,configurable:true}});queueMicrotask(()=>this.dispatchEvent(new Event("load")));});
 vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({drawImage:vi.fn()} as never);
 vi.spyOn(HTMLCanvasElement.prototype,"toDataURL").mockReturnValue("data:image/png;base64,UkVOREVSRUQ=");
 let chunks = 0;
 vi.spyOn(HTMLCanvasElement.prototype,"toBlob").mockImplementation(function(callback){ chunks++; if(mutate && chunks===2) cache.set(PAGE_ONE_URL,[cleanVerified("รอก่อนนะ")]);queueMicrotask(()=>callback(new Blob([`chunk-${chunks}`],{type:"image/jpeg"})));});
 const failure = vi.spyOn(console,"error").mockImplementation(()=>{});
 await restoreWorkspaceWith({bubbleCacheRef:{current:cache},restoreSavedSession:vi.fn().mockResolvedValue({pages:[{url:PAGE_ONE_URL,name:PAGE_ONE_NAME},{url:PAGE_TWO_URL,name:"page-two.png"}],currentPage:0,bubbleCache:new Map(),translatedImageCache:new Map()})});
 const completed = new Promise<void>(resolve=>vi.mocked(translationMockState.setTranslationResult as ReturnType<typeof vi.fn>).mockImplementation((message:unknown)=>{if(typeof message==="string" && (message.includes("สำเร็จ!")||message.includes("เกิดข้อผิดพลาดในการรวมภาพ"))) resolve();}));
 await act(async()=>{await requestExport(/Strip/); await completed;});
 const {saveBlob} = await import("@/lib/export/saveLocation");
 expect(chunks).toBe(2);
 if(mutate){expect(saveBlob).not.toHaveBeenCalled();expect(failure).toHaveBeenCalledExactlyOnceWith("Failed to generate long strip",expect.objectContaining({message:"หลักฐานหรือข้อความเปลี่ยนระหว่างส่งออก กรุณาตรวจหน้าและส่งออกใหม่"}));}
 else {expect(saveBlob).toHaveBeenCalledOnce();expect(vi.mocked(saveBlob).mock.calls[0][1]).toMatch(/\.zip$/);const JSZip=(await import("jszip")).default; const zip=await JSZip.loadAsync(await readBlobBytes(vi.mocked(saveBlob).mock.calls[0][0] as Blob));expect(Object.keys(zip.files)).toHaveLength(2);expect(failure).not.toHaveBeenCalled();}
 failure.mockRestore();
});

test.each([/ZIP/, /CBZ/, /PDF/, /Strip/, "รูปภาพหน้านี้"])("every output format blocks absent background before raster selection: %s", async (format) => {
 // Replace only the evidence accessor while keeping the real workspace actions.
 const base = vi.mocked(useCleaning)({pages:[],currentPage:0});
 vi.mocked(useCleaning).mockReturnValue({...base, getCurrentRemnantReview: () => undefined} as never);
 await restoreWorkspaceWith({bubbleCacheRef:{current:new Map([[PAGE_ONE_URL,[cleanVerified()]]])}, translatedImageCacheRef:{current:new Map([[PAGE_ONE_URL,STALE_RENDER_URL]])}});
 await requestExport(format);
 expect(await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export")).toBeTruthy();
 expect(downloadTranslatedImage).not.toHaveBeenCalled();
 expect(applyTranslationOverlay).not.toHaveBeenCalled();
 const {saveBlob} = await import("@/lib/export/saveLocation");
 expect(saveBlob).not.toHaveBeenCalled();
});

test("live changed known source box blocks output before the background recheck effect", async () => {
 const cache = new Map([[PAGE_ONE_URL,[cleanVerified()]]]);
 const base = vi.mocked(useCleaning)({pages:[],currentPage:0});
 const accessor = vi.fn((_url:string,expected?:{sourceContext:string;textEvidence:{id:string;box:number[]}[]}) => expected?.sourceContext==="src-1" && expected.textEvidence[0]?.box[1]===0 ? base.getCurrentRemnantReview(PAGE_ONE_URL) : undefined);
 vi.mocked(useCleaning).mockReturnValue({...base,getCurrentRemnantReview:accessor,setPageRemnantTextEvidence:vi.fn()} as never);
 await restoreWorkspaceWith({bubbleCacheRef:{current:cache}});
 cache.set(PAGE_ONE_URL,[{...cleanVerified(),box:[0,200,100,300]}]);
 await requestExport("รูปภาพหน้านี้");
 expect(await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export")).toBeTruthy();
 expect(accessor).toHaveBeenCalledWith(PAGE_ONE_URL,{sourceContext:"src-1",textEvidence:[{id:"0",box:[0,200,100,300]}]});
 expect(applyTranslationOverlay).not.toHaveBeenCalled();
 const {saveBlob}=await import("@/lib/export/saveLocation");expect(saveBlob).not.toHaveBeenCalled();
});

test("remnant findings open the comparison mask at the bounded candidate without resolving or recleaning", async () => {
 const base = vi.mocked(useCleaning)({pages:[],currentPage:0});
 const region = {id:"r",rect:{x:2,y:2,width:12,height:12},status:"ready",textRole:"dialogue",route:"flat"};
 const plane = {width:16,height:16,data:new Uint8Array(256).fill(255)};
 for(let y=4;y<12;y++) for(let x=4;x<12;x++) plane.data[y*16+x]=0;
 const inspection = inspectBackgroundRemnants({revisions:{sourceRevision:"src-1",backgroundRevision:"bg-1",removalRevision:"rm-1"},originalPlane:plane,cleanPlane:plane,removalRegions:[region] as never});
 expect(inspection.candidates.length).toBeGreaterThan(0);
 const resolve = vi.fn();
 const confirm = vi.fn();
 vi.mocked(useCleaning).mockReturnValue({...base,currentResult:{...cleaningResult,regions:[region]},currentRemnantReview:{inspection},getCurrentRemnantReview:()=>({inspection}),resolveMaskRegion:resolve,confirmArtworkCandidate:confirm} as never);
 await restoreWorkspaceWith({});
 fireEvent.click(screen.getAllByRole("button",{name:"แก้ Mask ที่จุดนี้"})[0]);
 const {MaskEditor} = await import("@/components/cleaning/MaskEditor");
 expect(vi.mocked(MaskEditor).mock.calls.at(-1)?.[0]).toMatchObject({cleanUrl:cleaningResult.cleanUrl,focusRect:inspection.candidates[0].rect});
 expect(resolve).not.toHaveBeenCalled();
 expect(base.cleanPage).not.toHaveBeenCalled();
 fireEvent.click(screen.getAllByRole("button",{name:"ยืนยันเป็นลายภาพ"})[0]);
 expect(confirm).toHaveBeenCalledWith(PAGE_ONE_URL,inspection.candidates[0].id);
});

test("single export renders fresh pixels and rejects text mutation during the asynchronous render", async () => {
 const originalWarn = console.warn;
 const expectedFailure = vi.spyOn(console, "warn").mockImplementation((...args) => {
   if (args[0] !== "Offscreen render failed for page 1") originalWarn(...args);
 });
 try {
 const cache = new Map([[PAGE_ONE_URL,[cleanVerified()]]]);
 await restoreWorkspaceWith({bubbleCacheRef:{current:cache}, translatedImageCacheRef:{current:new Map([[PAGE_ONE_URL,STALE_RENDER_URL]])}});
 vi.mocked(applyTranslationOverlay).mockImplementation((...args) => {
   cache.set(PAGE_ONE_URL,[cleanVerified("รอก่อนนะ")]);
   args[4]?.("data:image/png;base64,UkVOREVSRUQ=");
   return true as never;
 });
 await requestExport("รูปภาพหน้านี้");
 await waitFor(() => expect(applyTranslationOverlay).toHaveBeenCalled());
 await waitFor(() => expect(translationMockState.setTranslationResult).toHaveBeenCalledWith(expect.stringContaining("ส่งออกไม่สำเร็จ")));
 expect(downloadTranslatedImage).not.toHaveBeenCalled();
 const {saveBlob} = await import("@/lib/export/saveLocation");
 expect(saveBlob).not.toHaveBeenCalled();
 expect(expectedFailure).toHaveBeenCalledExactlyOnceWith("Offscreen render failed for page 1", expect.objectContaining({message:"ข้อความหรือหลักฐานเปลี่ยนระหว่างเรนเดอร์ กรุณาลองส่งออกใหม่"}));
 } finally {
   expectedFailure.mockRestore();
 }
});
