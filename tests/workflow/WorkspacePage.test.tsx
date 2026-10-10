import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CleaningToolbar } from "@/components/cleaning/CleaningToolbar";
import { MaskEditor } from "@/components/cleaning/MaskEditor";
import { useCleaning } from "@/hooks/useCleaning";
import { useTranslation } from "@/hooks/useTranslation";
import WorkspacePage from "@/src/app/page";
import { scanPageGeometry } from "@/lib/export/readabilityScan";
import { downloadTranslatedImage, applyTranslationOverlay, autoOrganizePageBubbles } from "@/lib/translationOverlay";
import { saveBlob } from "@/lib/export/saveLocation";
import { workspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";
import { LANGUAGE_POLICY_VERSION } from "@/lib/languagePolicy";
import { withReviewIdentity } from "@/lib/translation/qualityReview";

vi.mock("@/hooks/useCleaning");
vi.mock("@/hooks/useTranslation");
vi.mock("react-hot-toast", () => {
  const toastFn: any = vi.fn();
  toastFn.loading = vi.fn(() => "mock-toast-id");
  toastFn.success = vi.fn();
  toastFn.error = vi.fn();
  toastFn.dismiss = vi.fn();
  return {
    default: toastFn,
    Toaster: () => null,
  };
});
vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(),
  downloadTranslatedImage: vi.fn(),
  autoOrganizePageBubbles: vi.fn((bubbles) => ({
    optimizedBubbles: bubbles,
    adjustedCount: 1,
    resolvedCollisionCount: 0,
    unresolvedCollisionCount: 0,
  })),
  autoOrganizeAllPagesBubbles: vi.fn((pages) => ({
    pageResults: new Map(pages.map((p: any) => [p.pageUrl, p.bubbles])),
    totalAdjustedCount: 1,
    totalResolvedCollisions: 0,
  })),
  detectBubbleCollisions: vi.fn(() => []),
  syncPageOverlayAdjustments: vi.fn(),
}));
vi.mock("@/lib/export/readabilityScan", () => ({ scanPageGeometry: vi.fn() }));
vi.mock("@/components/cleaning/MaskLegend", () => ({
  MaskLegend: () => null,
}));
vi.mock("@/components/cleaning/CleaningToolbar", () => ({
  CleaningToolbar: vi.fn(
    ({
      hasTranslated,
      layer,
      onClean,
      onEditMask,
      onLayerChange,
      children,
    }: ComponentProps<typeof CleaningToolbar>) => (
      <section
        aria-label="Cleaning toolbar"
        data-has-translated={String(hasTranslated)}
        data-layer={layer}
      >
        <button type="button" onClick={onClean}>
          Clean current page
        </button>
        <button type="button" onClick={onEditMask}>
          Edit mask
        </button>
        {(["original", "clean", "translated", "mask"] as const).map(
          (nextLayer) => (
            <button
              key={nextLayer}
              type="button"
              onClick={() => onLayerChange(nextLayer)}
              disabled={nextLayer === "translated" && !hasTranslated}
            >
              Layer {nextLayer}
            </button>
          ),
        )}
        {children}
      </section>
    ),
  ),
}));
vi.mock("@/components/cleaning/MaskEditor", () => ({
  MaskEditor: vi.fn(
    ({ onRetry }: ComponentProps<typeof MaskEditor>) => (
      <div role="dialog" aria-label="Mask editor">
        <button
          type="button"
          onClick={() =>
            void onRetry(
              "region-1",
              new Blob(["mask"], { type: "image/png" }),
              "anime-lama",
              "force-clean",
            )
          }
        >
          Retry mask region
        </button>
      </div>
    ),
  ),
}));

const ORIGINAL_URL = "data:image/png;base64,ORIGINAL";
const CLEAN_URL = "data:image/png;base64,CLEAN";
const TRANSLATED_URL = "data:image/png;base64,TRANSLATED";
const PAGE_NAME = "page-one.png";
const cleaningResult = {
  sourceFingerprint: "src-1",
  width: 100,
  height: 100,
  pageId: ORIGINAL_URL,
  cleanUrl: CLEAN_URL,
  maskUrl: "data:image/png;base64,MASK",
  reviewMaskUrl: "data:image/png;base64,REVIEW",
  protectedMaskUrl: "data:image/png;base64,PROTECTED",
  diffUrl: "data:image/png;base64,DIFF",
  regions: [
    {
      id: "region-1",
      route: "anime-lama",
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      rect: { x: 10, y: 10, width: 20, height: 10 },
    },
  ],
};

const approvedBackgroundInspection = {
  status: "inspected" as const,
  revisionKey: "test-background-revision",
  revisions: { sourceRevision: "src-1", backgroundRevision: "bg-1", removalRevision: "rm-1" },
  candidates: [],
  inspectedAreas: 1,
};

function acceptedBubble<T extends { t?: string; original_text?: string }>(bubble: T) {
  const sourceText = bubble.original_text ?? "Hello";
  const reviewedText = bubble.t ?? "สวัสดี";
  return {
    ...bubble,
    original_text: sourceText,
    translationReview: withReviewIdentity({ status: "accepted", sourceText, reviewedText }, "Thai", "src-1"),
  };
}

let cleanCurrentPage: ReturnType<typeof vi.fn>;
let retryRegion: ReturnType<typeof vi.fn>;
let invalidatePageTranslation: ReturnType<typeof vi.fn>;
let refreshPageTranslation: ReturnType<typeof vi.fn>;
let handleTranslate: ReturnType<typeof vi.fn>;
let translationMockState: Record<string, unknown>;
let cleaningMockState: Record<string, unknown>;

function toolbar(): HTMLElement {
  return screen.getByRole("region", { name: "Cleaning toolbar" });
}

function mainImage(): HTMLImageElement {
  const image = document.querySelector<HTMLImageElement>(
    `#pageContainer img[title="${PAGE_NAME}"]`,
  );
  if (!image) throw new Error("Main page image was not rendered.");
  return image;
}

function workspaceFrame(): HTMLElement {
  const frame = document.querySelector<HTMLElement>(
    "#pageContainer",
  )?.parentElement;
  if (!frame) throw new Error("Workspace frame was not rendered.");
  return frame;
}

async function renderRestoredWorkspace() {
  const rendered = render(<WorkspacePage />);
  const restoreButton = await screen.findByRole("button", { name: /คืนค่างานเดิม/ });
  await act(async () => { fireEvent.click(restoreButton); });
  await waitFor(() => expect(mainImage()).toBeTruthy());
  return rendered;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(applyTranslationOverlay).mockImplementation((...args) => {
    args[4]?.(TRANSLATED_URL);
    return true as never;
  });
  const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function(this: HTMLImageElement, url) {
    imageSrc.set?.call(this, url);
    if (this.id === "offscreen-image") queueMicrotask(() => this.dispatchEvent(new Event("load")));
  });
  cleanCurrentPage = vi.fn().mockResolvedValue(cleaningResult);
  retryRegion = vi.fn().mockResolvedValue(cleaningResult);
  invalidatePageTranslation = vi.fn();
  refreshPageTranslation = vi.fn().mockResolvedValue(undefined);
  handleTranslate = vi.fn().mockResolvedValue(true);

  cleaningMockState = {
    getCurrentRemnantReview: vi.fn(() => ({ inspection: approvedBackgroundInspection })),
    cleanPage: vi.fn().mockResolvedValue(cleaningResult),
    cleanCurrentPage,
    retryRegion,
    cancelPolling: vi.fn(),
    currentResult: cleaningResult,
    progress: undefined,
    error: undefined,
    resultsByPage: new Map([[ORIGINAL_URL, cleaningResult]]),
  };
  vi.mocked(useCleaning).mockReturnValue(cleaningMockState as never);
  translationMockState = {
    targetLang: "Thai",
    setTargetLang: vi.fn(),
    pageTargetCacheRef: { current: new Map([[ORIGINAL_URL, { targetId: "th", policyVersion: LANGUAGE_POLICY_VERSION }]]) },
    getPageTargetLanguage: vi.fn(() => "th"),
    sourceLang: "auto",
    setSourceLang: vi.fn(),
    modelPreference: "auto",
    setModelPreference: vi.fn(),
    allowPreviewModels: false,
    setAllowPreviewModels: vi.fn(),
    glossary: [],
    setGlossary: vi.fn(),
    textStyle: {
      fontFamily: "Itim, sans-serif",
      textColor: "#000000",
      textOutline: "#FFFFFF",
      fontSizeMultiplier: 1,
    },
    setTextStyle: vi.fn(),
    nsfwBypassMode: false,
    setNsfwBypassMode: vi.fn(),
    isTranslating: false,
    translationResult: null,
    setTranslationResult: vi.fn(),
    showTranslate: false,
    setShowTranslate: vi.fn(),
    handleTranslate,
    isTranslatingAll: false,
    translateAllProgress: null,
    handleTranslateAll: vi.fn().mockResolvedValue(undefined),
    cancelTranslateAll: vi.fn(),
    translateCrop: vi.fn(),
    activeBubbles: [
      {
        id: "bubble-1",
        originalText: "Hello",
        original_text: "Hello",
        translatedText: "สวัสดี",
        t: "สวัสดี",
        box: [100, 100, 200, 300],
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.1,
        translationReview: withReviewIdentity({ status: "accepted", sourceText: "Hello", reviewedText: "สวัสดี" }, "Thai", "src-1"),
      },
    ],
    setActiveBubbles: vi.fn(),
    translatedImages: new Map([[ORIGINAL_URL, TRANSLATED_URL]]),
    translatedImageCacheRef: {
      current: new Map([[ORIGINAL_URL, TRANSLATED_URL]]),
    },
    bubbleCacheRef: { current: new Map() },
    textStyleRef: { current: {} },
    userApiKey: "",
    setUserApiKey: vi.fn(),
    restoreSavedSession: vi.fn().mockResolvedValue({
      pages: [{ url: ORIGINAL_URL, name: PAGE_NAME }],
      currentPage: 0,
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
    invalidatePageTranslation,
    refreshPageTranslation,
    scanTranslatedPages: vi.fn(() => []),
    inspectTranslatedPages: vi.fn(() => []),
    inspectLegacyTargets: vi.fn(() => []),
    confirmLegacyTarget: vi.fn(() => 0),
    inspectReviewIssues: vi.fn(() => []),
    confirmPointReview: vi.fn(() => true),
    repairWholeBook: vi.fn().mockResolvedValue({
      pagesRepaired: 0,
      pointsRepaired: 0,
      cancelled: false,
      unresolved: [],
      skipped: [],
    }),
    cancelWholeBookRepair: vi.fn(),
    isRepairingBook: false,
    replaceBubbleText: vi.fn(() => 0),
    getPageSignature: vi.fn(() => "rev-0"),
    getPageSourceRevision: vi.fn(() => "src-1"),
    getPageRevision: vi.fn(() => 0),
    cacheRevision: 0,
  };
  translationMockState.bubbleCacheRef = {
    current: new Map([[ORIGINAL_URL, translationMockState.activeBubbles]]),
  };
  vi.mocked(useTranslation).mockReturnValue(translationMockState as never);
  vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(
        new Blob(["original"], { type: "image/png" }),
      ),
    }),
  );
});

test("shows elapsed stopwatch time instead of an ETA during batch translation", () => {
  const baseTranslationState = vi.mocked(useTranslation)({} as never);
  vi.mocked(useTranslation).mockClear();
  vi.mocked(useTranslation).mockReturnValue({
    ...baseTranslationState,
    isTranslatingAll: true,
    translateAllProgress: {
      current: 1,
      total: 4,
      status: "translating",
      message: "กำลังแปลหน้า 1/4",
      startTime: 0,
      elapsedMs: 12_345,
      pageElapsedMs: 6_789,
    },
  } as never);

  render(<WorkspacePage />);

  expect(
    screen.getByText(/กำลังแปลหน้า 1\/4.*⏱ 00:06\.7.*รวม 00:12\.3.*25%/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/เหลืออีก|ประเมินเวลาที่เหลือ/)).not.toBeInTheDocument();
});

describe("workspace clean-then-translate integration", () => {
  test("passes preparation cancellation through fetch and cleaning", async () => {
    await renderRestoredWorkspace();
    const prepare = vi.mocked(useTranslation).mock.calls.at(-1)![0].preparePageForTranslation;
    const controller = new AbortController();
    await prepare(ORIGINAL_URL, 0, controller.signal);
    expect(fetch).toHaveBeenCalledWith(ORIGINAL_URL, { signal: controller.signal });
    expect(vi.mocked(useCleaning).mock.results.at(-1)!.value.cleanPage).toHaveBeenCalledWith(
      ORIGINAL_URL, expect.any(Blob), false, controller.signal,
    );
  });

  test("does not register resources if cancellation arrives as cleaning completes", async () => {
    await renderRestoredWorkspace();
    const prepare = vi.mocked(useTranslation).mock.calls.at(-1)![0].preparePageForTranslation;
    const controller = new AbortController();
    const cleanPage = vi.mocked(useCleaning).mock.results.at(-1)!.value.cleanPage;
    cleanPage.mockImplementation(async () => {
      controller.abort();
      return cleaningResult;
    });
    const register = vi.spyOn(workspaceResourceManager, "registerResource");
    register.mockClear();
    await expect(prepare(ORIGINAL_URL, 0, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(register).not.toHaveBeenCalled();
    register.mockRestore();
  });

  test("shows the clean background while current-page translation is pending", async () => {
    handleTranslate.mockImplementation(() => new Promise(() => {}));
    translationMockState.translatedImages = new Map();
    translationMockState.translatedImageCacheRef = { current: new Map() };
    const cleaningState = vi.mocked(useCleaning)({} as never);
    vi.mocked(useCleaning).mockReturnValue({ ...cleaningState, currentResult: undefined, resultsByPage: new Map() } as never);
    const rendered = await renderRestoredWorkspace();
    fireEvent.keyDown(window, { key: "T" });
    await waitFor(() => expect(handleTranslate).toHaveBeenCalledTimes(1));
    expect(mainImage()).toHaveAttribute("src", ORIGINAL_URL);
    vi.mocked(useCleaning).mockReturnValue(cleaningState);
    rendered.rerender(<WorkspacePage />);
    expect(mainImage()).toHaveAttribute("src", CLEAN_URL);
    expect(toolbar()).toHaveAttribute("data-layer", "translated");
  });

  test.each(["original", "clean"])("preserves the selected %s layer when translation finishes", async (layer) => {
    let finish!: (result: boolean) => void;
    handleTranslate.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await renderRestoredWorkspace();
    fireEvent.keyDown(window, { key: "T" });
    await waitFor(() => expect(handleTranslate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: `Layer ${layer}` }));
    await act(async () => { finish(true); });
    expect(toolbar()).toHaveAttribute("data-layer", layer);
  });

  test("supplies clean-page preparation to translation", () => {
    render(<WorkspacePage />);
    expect(
      vi.mocked(useTranslation).mock.calls[0][0]
        .preparePageForTranslation,
    ).toEqual(expect.any(Function));
  });

  test("exposes translated availability and one workspace layer through the toolbar", async () => {
    await renderRestoredWorkspace();
    expect(toolbar().getAttribute("data-has-translated")).toBe("true");
    expect(toolbar().getAttribute("data-layer")).toBe("original");
  });

  test("selects translated after current-page translation succeeds", async () => {
    await renderRestoredWorkspace();
    fireEvent.keyDown(window, { key: "T" });
    await waitFor(() => expect(handleTranslate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toolbar().getAttribute("data-layer")).toBe("translated"),
    );
  });

  test("manual cleaning invalidates stale translation and selects clean", async () => {
    await renderRestoredWorkspace();
    fireEvent.click(
      screen.getByRole("button", { name: "Clean current page" }),
    );
    await waitFor(() => expect(cleanCurrentPage).toHaveBeenCalledTimes(1));
    expect(invalidatePageTranslation).toHaveBeenCalledWith(ORIGINAL_URL);
    expect(toolbar().getAttribute("data-layer")).toBe("clean");
  });

  test("failed manual cleaning preserves existing translation without invalidating", async () => {
    cleanCurrentPage.mockResolvedValue(undefined);
    await renderRestoredWorkspace();
    fireEvent.click(
      screen.getByRole("button", { name: "Clean current page" }),
    );
    await waitFor(() => expect(cleanCurrentPage).toHaveBeenCalledTimes(1));
    expect(invalidatePageTranslation).not.toHaveBeenCalled();
    expect(toolbar().getAttribute("data-layer")).not.toBe("clean");
  });

  test("failed mask retry preserves existing translation without invalidating", async () => {
    retryRegion.mockResolvedValue(undefined);
    await renderRestoredWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Edit mask" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry mask region" }),
    );
    await waitFor(() => expect(retryRegion).toHaveBeenCalledTimes(1));
    expect(invalidatePageTranslation).not.toHaveBeenCalled();
    expect(toolbar().getAttribute("data-layer")).not.toBe("clean");
  });

  test("export report lists per-page translation and cleaning state", async () => {
    vi.mocked(useTranslation).mockReturnValue({
      ...translationMockState,
      inspectTranslatedPages: vi.fn(() => [
        { pageUrl: ORIGINAL_URL, pageIndex: 0, total: 5, contaminated: 1, invalidBoxes: 1 },
      ]),
    } as never);
    await renderRestoredWorkspace();

    fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "รายงานก่อนส่งออก" }),
    );

    const report = await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" });
    expect(within(report).getAllByRole("row")).toHaveLength(2); // header + one page
    expect(report).toHaveTextContent("1 จุด"); // contaminated + invalid box cells
    fireEvent.click(within(report).getByRole("button", { name: "ปิดรายงานก่อนส่งออก" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" }),
      ).toBeNull(),
    );
  });

  test("export report names an overflowing text item and selects its overlay", async () => {
    const bubble = { id: "bubble-1", t: "ข้อความยาว", box: [100, 100, 200, 300] };
    vi.mocked(useTranslation).mockReturnValue({
      ...translationMockState,
      bubbleCacheRef: { current: new Map([[ORIGINAL_URL, [bubble]]]) },
      inspectTranslatedPages: vi.fn(() => [
        { pageUrl: ORIGINAL_URL, pageIndex: 0, total: 1, contaminated: 0, invalidBoxes: 0 },
      ]),
    } as never);
    vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [
      { pageUrl: ORIGINAL_URL, pageIndex: 0, bubbleId: "id-bubble-1", text: "ข้อความยาว", kind: "overflow" },
      { pageUrl: ORIGINAL_URL, pageIndex: 0, bubbleId: "id-bubble-1", text: "ข้อความยาว", kind: "color" },
    ] });
    await renderRestoredWorkspace();
    const overlay = document.createElement("button");
    overlay.setAttribute("data-bubble-id", "id-bubble-1");
    document.querySelector("#pageContainer")?.appendChild(overlay);
    fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "รายงานก่อนส่งออก" }));

    const finding = await screen.findByRole("button", { name: /หน้า 1.*ข้อความล้น.*ข้อความยาว/ });
    expect(screen.getByRole("button", { name: /หน้า 1.*สีกลืน.*ข้อความยาว/ })).toBeTruthy();
    fireEvent.click(finding);
    await waitFor(() => expect(overlay).toHaveAttribute("data-readability-target", "true"));
    expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeNull();
  });

  test("single-page export waits for a readability choice and can continue", async () => {
    const bubble = acceptedBubble({ id: "bubble-1", t: "ข้อความยาว", box: [100, 100, 200, 300] });
    vi.mocked(useTranslation).mockReturnValue({
      ...translationMockState,
      bubbleCacheRef: { current: new Map([[ORIGINAL_URL, [bubble]]]) },
    } as never);
    vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [
      { pageUrl: ORIGINAL_URL, pageIndex: 0, bubbleId: "id-bubble-1", text: "ข้อความยาว", kind: "overflow" },
    ] });
    await renderRestoredWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Layer translated" }));
    fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
    const report = await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" });
    expect(vi.mocked(scanPageGeometry)).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 0 }));
    expect(downloadTranslatedImage).not.toHaveBeenCalled();
    fireEvent.click(within(report).getByRole("button", { name: "ส่งออกต่อ" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
  });

  test("returning to edit discards the export and a new attempt scans again", async () => {
    vi.mocked(scanPageGeometry)
      .mockResolvedValueOnce({ findings: [
        { pageUrl: ORIGINAL_URL, pageIndex: 0, bubbleId: "id-bubble-1", text: "สวัสดี", kind: "overflow" },
      ] })
      .mockResolvedValue({ findings: [] });
    await renderRestoredWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Layer translated" }));
    const requestImage = async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
      fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
    };
    await requestImage();
    fireEvent.click(within(await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" }))
      .getByRole("button", { name: "กลับไปแก้" }));
    expect(downloadTranslatedImage).not.toHaveBeenCalled();
    await requestImage();
    await waitFor(() => expect(vi.mocked(scanPageGeometry)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeNull();
  });

  test("book export offers progress and early continuation without a late popup", async () => {
    let finishScan!: (value: { findings: [] }) => void;
    vi.mocked(scanPageGeometry).mockReturnValue(new Promise((resolve) => { finishScan = resolve; }));
    vi.mocked(useTranslation).mockReturnValue({
      ...translationMockState,
      bubbleCacheRef: { current: new Map([[ORIGINAL_URL, [
        acceptedBubble({ id: "bubble-1", t: "สวัสดี", box: [100, 100, 200, 300] }),
      ]]]) },
    } as never);
    await renderRestoredWorkspace();
    fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "ZIP" }));
    const report = await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" });
    expect(report).toHaveTextContent("กำลังตรวจ");
    fireEvent.click(within(report).getByRole("button", { name: "ส่งออกต่อโดยไม่รอผลตรวจ" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeNull());
    finishScan({ findings: [] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeNull());
  });

  test.each(["ZIP", "CBZ", "PDF", "Strip"])("%s book export checks readability", async (format) => {
    vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [
      { pageUrl: ORIGINAL_URL, pageIndex: 0, bubbleId: "id-bubble-1", text: "สวัสดี", kind: "overflow" },
    ] });
    await renderRestoredWorkspace();
    fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: format === "Strip" ? /^Strip/ : format }));
    expect(await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" })).toHaveTextContent("ข้อความล้น");
    expect(vi.mocked(scanPageGeometry)).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 0 }));
  });

  test("book report keeps completed findings when a later page cannot be checked", async () => {
    vi.mocked(useTranslation).mockReturnValue({
      ...translationMockState,
      restoreSavedSession: vi.fn().mockResolvedValue({
        pages: [
          { url: ORIGINAL_URL, name: PAGE_NAME },
          { url: "second-page", name: "second.png" },
        ],
        currentPage: 0,
      }),
    } as never);
    vi.mocked(scanPageGeometry)
      .mockResolvedValueOnce({ findings: [
        { pageUrl: ORIGINAL_URL, pageIndex: 0, bubbleId: "id-bubble-1", text: "สวัสดี", kind: "overflow" },
      ] })
      .mockResolvedValueOnce({ findings: [], unavailableReason: "โหลดภาพพื้นหลังไม่สำเร็จ" });
    await renderRestoredWorkspace();
    fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "ZIP" }));
    const report = await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" });
    await waitFor(() => expect(vi.mocked(scanPageGeometry)).toHaveBeenCalledTimes(2));
    expect(report).toHaveTextContent("ข้อความล้น");
    expect(report).toHaveTextContent("โหลดภาพพื้นหลังไม่สำเร็จ");
  });

  test("acknowledged warning does not interrupt a second export until page revision changes", async () => {
    let revision = "rev-0";
    vi.mocked(useTranslation).mockReturnValue({
      ...translationMockState,
      getPageSignature: vi.fn(() => revision),
      bubbleCacheRef: { current: new Map([[ORIGINAL_URL, [
        acceptedBubble({ id: "bubble-1", t: "สวัสดี", box: [100, 100, 200, 300] }),
      ]]]) },
    } as never);
    vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [
      { pageUrl: ORIGINAL_URL, pageIndex: 0, bubbleId: "id-bubble-1", text: "สวัสดี", kind: "overflow" },
    ] });
    await renderRestoredWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Layer translated" }));
    const requestImage = async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
      fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
    };
    await requestImage();
    const report = await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" });
    fireEvent.click(within(report).getByRole("button", { name: "ส่งออกต่อ" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeNull());
    await requestImage();
    await waitFor(() => expect(vi.mocked(scanPageGeometry)).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeNull();
    revision = "rev-1";
    await requestImage();
    expect(await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeTruthy();
  });

  test("an unavailable result is shown again after continuing an export", async () => {
    vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [], unavailableReason: "ตรวจสีไม่ได้" });
    await renderRestoredWorkspace();
    const requestImage = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Layer translated" }));
      fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
      fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
    };
    await requestImage();
    fireEvent.click(within(await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" }))
      .getByRole("button", { name: "ส่งออกต่อ" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeNull());
    // The image route remains available for a second attempt in the same workspace.
    fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
    expect(await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" })).toHaveTextContent("ตรวจสีไม่ได้");
  });

  test("whole-book scan flags contaminated pages and retranslates only those", async () => {
    const translateAll = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useTranslation).mockReturnValue({
      ...translationMockState,
      handleTranslateAll: translateAll,
      scanTranslatedPages: vi.fn(() => [
        { pageUrl: ORIGINAL_URL, pageIndex: 0, contaminated: 2, total: 5 },
      ]),
    } as never);
    await renderRestoredWorkspace();

    const toolsTrigger = screen.getAllByRole("button", { name: "เครื่องมือ" })[0];
    fireEvent.click(toolsTrigger);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "ตรวจคำแปลทั้งเล่ม" }),
    );

    // The scan result flips the menu item into a targeted re-translate.
    fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /แปลใหม่ 1 หน้า/ }),
    );
    await waitFor(() => expect(translateAll).toHaveBeenCalledWith([0]));
  });

  test("mask retry preserves translations and re-renders over the new clean", async () => {
    await renderRestoredWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Edit mask" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry mask region" }),
    );
    await waitFor(() =>
      expect(retryRegion).toHaveBeenCalledWith(
        "region-1",
        expect.any(Blob),
        "anime-lama",
        "force-clean",
      ),
    );
    // The cleaned pixels changed but the translations still apply: they are
    // re-rendered over the fresh cleaning instead of being wiped.
    expect(refreshPageTranslation).toHaveBeenCalledWith(ORIGINAL_URL, CLEAN_URL);
    expect(invalidatePageTranslation).not.toHaveBeenCalled();
    expect(toolbar().getAttribute("data-layer")).toBe("clean");
  });

  test("layer choices control single image source and translation visibility", async () => {
    await renderRestoredWorkspace();
    expect(mainImage().getAttribute("src")).toBe(ORIGINAL_URL);
    expect(workspaceFrame().classList.contains("hide-translation")).toBe(true);

    fireEvent.click(
      within(toolbar()).getByRole("button", { name: "Layer clean" }),
    );
    expect(mainImage().getAttribute("src")).toBe(CLEAN_URL);
    expect(workspaceFrame().classList.contains("hide-translation")).toBe(true);

    fireEvent.click(
      within(toolbar()).getByRole("button", { name: "Layer translated" }),
    );
    expect(mainImage().getAttribute("src")).toBe(CLEAN_URL);
    expect(workspaceFrame().classList.contains("hide-translation")).toBe(false);

    fireEvent.click(
      within(toolbar()).getByRole("button", { name: "Layer mask" }),
    );
    expect(mainImage().getAttribute("src")).toBe(CLEAN_URL);
    expect(
      screen.getByRole("img", { name: "Eligible cleaning mask" }),
    ).toBeTruthy();
  });

  test("layers map to original, clean, and rendered sources in scroll view", async () => {
    await renderRestoredWorkspace();
    fireEvent.click(screen.getByTitle("โหมดทีละหน้า"));
    const scrollImage = () => screen.getByRole("img", { name: "Page 1" });
    expect(scrollImage().getAttribute("src")).toBe(ORIGINAL_URL);

    fireEvent.click(
      within(toolbar()).getByRole("button", { name: "Layer clean" }),
    );
    expect(scrollImage().getAttribute("src")).toBe(CLEAN_URL);

    fireEvent.click(
      within(toolbar()).getByRole("button", { name: "Layer translated" }),
    );
    expect(scrollImage().getAttribute("src")).toMatch(/^blob:/);
  });

  test("Space and eye toggle between original and translated", async () => {
    await renderRestoredWorkspace();
    await waitFor(() => expect(toolbar().getAttribute("data-has-translated")).toBe("true"));
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(toolbar().getAttribute("data-layer")).toBe("translated"));

    fireEvent.click(screen.getByTitle(/ต้นฉบับ|คำแปล/));
    expect(toolbar().getAttribute("data-layer")).toBe("original");

    fireEvent.click(screen.getByTitle(/ต้นฉบับ|คำแปล/));
    expect(toolbar().getAttribute("data-layer")).toBe("translated");
  });

  test("allows switching to translated layer when bubbles exist even without rendered bitmap in translatedImages map", async () => {
    await renderRestoredWorkspace();
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Layer original" }));
    expect(toolbar().getAttribute("data-layer")).toBe("original");
    expect(toolbar().getAttribute("data-has-translated")).toBe("true");

    fireEvent.click(within(toolbar()).getByRole("button", { name: "Layer translated" }));
    expect(toolbar().getAttribute("data-layer")).toBe("translated");
  });

  test("renders tools menu on mobile header and inside mobile drawer when pages are present", async () => {
    await renderRestoredWorkspace();

    const mobileHeader = document.querySelector<HTMLElement>("[data-workspace-header-mobile]");
    expect(mobileHeader).toBeInTheDocument();
    if (!mobileHeader) throw new Error("mobileHeader not found");

    // "เครื่องมือ" dropdown must exist in mobile header
    const toolsBtn = within(mobileHeader).getByRole("button", { name: "เครื่องมือ" });
    expect(toolsBtn).toBeInTheDocument();

    // Open mobile menu
    const menuBtn = within(mobileHeader).getByRole("button", { name: /เปิดเมนู/i });
    fireEvent.click(menuBtn);

    // Tools section must exist in mobile drawer
    expect(screen.getByRole("button", { name: /แปลหน้านี้ใหม่/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /คลีนข้อความใหม่/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /แก้ Mask/i })).toBeInTheDocument();
  });
});

describe("global keyboard shortcut guards", () => {
  async function renderTwoPageWorkspace() {
    translationMockState = {
      ...translationMockState,
      restoreSavedSession: vi.fn().mockResolvedValue({
        pages: [
          { url: ORIGINAL_URL, name: PAGE_NAME },
          { url: CLEAN_URL, name: "page-two.png" },
        ],
        currentPage: 0,
      }),
    };
    vi.mocked(useTranslation).mockReturnValue(translationMockState as never);
    render(<WorkspacePage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /คืนค่างานเดิม/ }),
    );
    await waitFor(() => expect(mainImage()).toBeTruthy());
  }

  function mainImageTitle(): string | null {
    return (
      document
        .querySelector<HTMLImageElement>("#pageContainer img")
        ?.getAttribute("title") ?? null
    );
  }

  test("arrow-key navigation is suppressed while a dialog is open and resumes after close", async () => {
    await renderTwoPageWorkspace();

    fireEvent.keyDown(window, { key: "?" });
    const dialog = screen.getByRole("dialog", {
      name: "คีย์ลัดสำหรับแก้ไขมังงะ",
    });
    expect(dialog).toBeInTheDocument();

    // Focus lives inside the dialog, so shortcuts must not reach the page below it.
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(mainImageTitle()).toBe(PAGE_NAME);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(mainImageTitle()).toBe("page-two.png");
  });

  test("space activates the focused button instead of toggling layers", async () => {
    await renderRestoredWorkspace();
    const button = screen.getByRole("button", { name: "Clean current page" });
    let defaultPrevented: boolean | undefined;
    const probe = (event: KeyboardEvent) => {
      if (event.key === " ") defaultPrevented = event.defaultPrevented;
    };
    window.addEventListener("keydown", probe);
    try {
      fireEvent.keyDown(button, { key: " " });
    } finally {
      window.removeEventListener("keydown", probe);
    }
    expect(defaultPrevented).toBe(false);
    expect(toolbar().getAttribute("data-layer")).toBe("original");
  });

  test("arrow keys do not change pages while the Mask Editor dialog is open", async () => {
    await renderTwoPageWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Edit mask" }));
    const dialog = await screen.findByRole("dialog", { name: "Mask editor" });

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(mainImageTitle()).toBe(PAGE_NAME);
  });
});

test("blank original page can select image export without readability scan", async () => {
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState, activeBubbles: [],
    bubbleCacheRef: { current: new Map() } } as never);
  await renderRestoredWorkspace();
  fireEvent.change(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" }), { target: { value: "original" } });
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  const item = await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" });
  expect(item).not.toHaveAttribute("aria-disabled", "true");
  fireEvent.click(item);
  await waitFor(() => expect(translationMockState.setTranslationResult).toHaveBeenCalledWith(expect.stringContaining("บันทึก SuperK_Page_001")));
  expect(scanPageGeometry).not.toHaveBeenCalled();
  expect(downloadTranslatedImage).not.toHaveBeenCalled();
});

vi.mock("@/lib/export/saveLocation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/export/saveLocation")>(),
  saveBlob: vi.fn().mockImplementation(async (_blob, name) => name),
}));

async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => { const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob); });
}

test("source choice survives navigation independently of preview layer", async () => {
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [
      { url: ORIGINAL_URL, name: PAGE_NAME }, { url: "second-page", name: "second.png" }], currentPage: 0 }) } as never);
  await renderRestoredWorkspace();
  fireEvent.change(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" }), { target: { value: "original" } });
  fireEvent.click(screen.getByRole("button", { name: "หน้าถัดไป (หน้า 2 จาก 2)" }));
  expect(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" })).toHaveValue("translated");
  fireEvent.change(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" }), { target: { value: "clean" } });
  fireEvent.click(screen.getByRole("button", { name: "หน้าที่แล้ว (หน้า 1 จาก 2)" }));
  expect(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" })).toHaveValue("original");
  expect(vi.mocked(useTranslation).mock.calls.at(-1)?.[0].pageExportSources).toEqual(["original", "clean"]);
});

test("single original export preserves blob bytes and actual MIME extension", async () => {
  const { saveBlob } = await import("@/lib/export/saveLocation");
  const raw = new Blob(["raw webp pixels"], { type: "image/webp" });
  vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => raw } as Response);
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState, activeBubbles: [],
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [{ url: "blob:fixture", name: PAGE_NAME, exportSource: "original" }], currentPage: 0 }) } as never);
  render(<WorkspacePage />);
  fireEvent.click(await screen.findByRole("button", { name: /คืนค่างานเดิม/ }));
  await screen.findByRole("combobox", { name: "ส่งออกหน้านี้เป็น" });
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
  await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(raw, "SuperK_Page_001_page-one.webp", null));
  expect(scanPageGeometry).not.toHaveBeenCalled();
});

test.each(["ZIP", "CBZ"])("mixed %s includes original, clean and translated bytes with MIME filenames", async (format) => {
  const { saveBlob } = await import("@/lib/export/saveLocation");
  const JSZip = (await import("jszip")).default;
  const original = "data:image/webp;base64,b3JpZ2luYWw=";
  const cleanPage = "data:image/png;base64,c291cmNl";
  const translatedPage = "data:image/png;base64,dGhpcmQ=";
  const clean = "data:image/png;base64,Y2xlYW4=";
  const translated = "data:image/jpeg;base64,dHJhbnNsYXRlZA==";
  vi.mocked(applyTranslationOverlay).mockImplementation((...args) => { args[4]?.(translated); return true as never; });
  vi.mocked(useCleaning).mockReturnValue({ ...cleaningMockState,
    resultsByPage: new Map([[cleanPage, { ...cleaningResult, cleanUrl: clean }],
      [translatedPage, { ...cleaningResult, cleanUrl: clean, regions: [] }]]) } as never);
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    pageTargetCacheRef: { current: new Map([[translatedPage, { targetId: "th", policyVersion: LANGUAGE_POLICY_VERSION }]]) },
    bubbleCacheRef: { current: new Map([[translatedPage, [acceptedBubble({ t: "คำแปล", box: [100, 100, 200, 300] })]]]) },
    translatedImageCacheRef: { current: new Map([[translatedPage, translated]]) },
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [
      { url: original, name: "original.png", exportSource: "original" },
      { url: cleanPage, name: "clean.jpg", exportSource: "clean" },
      { url: translatedPage, name: "translated.png" }], currentPage: 0 }) } as never);
  render(<WorkspacePage />);
  fireEvent.click(await screen.findByRole("button", { name: /คืนค่างานเดิม/ }));
  await screen.findByRole("combobox", { name: "ส่งออกหน้านี้เป็น" });
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp("^" + format + "$") }));
  await waitFor(() => expect(saveBlob).toHaveBeenCalled());
  const blob = vi.mocked(saveBlob).mock.calls.at(-1)![0];
  const zip = await JSZip.loadAsync(await readBlobBytes(blob));
  expect(await zip.file("SuperK_Page_001_original.webp")!.async("string")).toBe("original");
  expect(await zip.file("SuperK_Page_002_clean.png")!.async("string")).toBe("clean");
  expect(await zip.file("SuperK_Page_003_translated.jpg")!.async("string")).toBe("translated");
  expect(scanPageGeometry).toHaveBeenCalledTimes(1);
  expect(downloadTranslatedImage).not.toHaveBeenCalled();
});

test.each(["ZIP", "CBZ"])("%s exports explicit originals and bubble-free translated pages as clean bytes", async (format) => {
  const { saveBlob } = await import("@/lib/export/saveLocation");
  const JSZip = (await import("jszip")).default;
  const blankPage = "data:image/png;base64,cGFnZQ==";
  const cleanOnlyPage = "data:image/png;base64,Y2xlYW5vbmx5";
  const clean = "data:image/png;base64,Y2xlYW4=";
  vi.mocked(useCleaning).mockReturnValue({ ...cleaningMockState,
    resultsByPage: new Map([[cleanOnlyPage, { ...cleaningResult, cleanUrl: clean }]]) } as never);
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    activeBubbles: [],
    translatedImageCacheRef: { current: new Map() },
    bubbleCacheRef: { current: new Map() },
    pageTargetCacheRef: { current: new Map([[cleanOnlyPage, { targetId: "th", policyVersion: LANGUAGE_POLICY_VERSION }]]) },
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [
      { url: blankPage, name: "blank.png", exportSource: "original" },
      { url: cleanOnlyPage, name: "cleanonly.png" }], currentPage: 0 }) } as never);
  render(<WorkspacePage />);
  fireEvent.click(await screen.findByRole("button", { name: /คืนค่างานเดิม/ }));
  await screen.findByRole("combobox", { name: "ส่งออกหน้านี้เป็น" });
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp("^" + format + "$") }));
  await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export");
  fireEvent.click(screen.getByRole("button", { name: "ยืนยันทุกหน้าและดำเนินการ Export" }));
  await waitFor(() => expect(saveBlob).toHaveBeenCalled());
  const blob = vi.mocked(saveBlob).mock.calls.at(-1)![0];
  const zip = await JSZip.loadAsync(await readBlobBytes(blob));
  expect(await zip.file("SuperK_Page_001_blank.png")!.async("string")).toBe("page");
  expect(await zip.file("SuperK_Page_002_cleanonly.png")!.async("string")).toBe("clean");
});

test("single-image export of a bubble-free page saves its clean render after review confirmation", async () => {
  const { saveBlob } = await import("@/lib/export/saveLocation");
  const cleanOnlyPage = "data:image/png;base64,Y2xlYW5vbmx5";
  const clean = "data:image/png;base64,Y2xlYW4=";
  vi.mocked(useCleaning).mockReturnValue({ ...cleaningMockState,
    resultsByPage: new Map([[cleanOnlyPage, { ...cleaningResult, cleanUrl: clean }]]) } as never);
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    activeBubbles: [],
    translatedImageCacheRef: { current: new Map() },
    bubbleCacheRef: { current: new Map() },
    pageTargetCacheRef: { current: new Map([[cleanOnlyPage, { targetId: "th", policyVersion: LANGUAGE_POLICY_VERSION }]]) },
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [{ url: cleanOnlyPage, name: "cleanonly.png" }], currentPage: 0 }) } as never);
  render(<WorkspacePage />);
  fireEvent.click(await screen.findByRole("button", { name: /คืนค่างานเดิม/ }));
  await screen.findByRole("combobox", { name: "ส่งออกหน้านี้เป็น" });
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
  await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export");
  fireEvent.click(screen.getByRole("button", { name: "ยืนยันทุกหน้าและดำเนินการ Export" }));
  await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(
    expect.objectContaining({ type: "image/png" }), "SuperK_Page_001_cleanonly.png", null));
  expect(downloadTranslatedImage).not.toHaveBeenCalled();
});

test("navigation and selection remain frozen while readability confirmation is pending", async () => {
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [
      { url: ORIGINAL_URL, name: PAGE_NAME }, { url: "second-page", name: "second.png" }], currentPage: 0 }) } as never);
  vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [], unavailableReason: "fixture warning" });
  await renderRestoredWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "Layer translated" }));
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
  await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" });
  expect(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "หน้าถัดไป (หน้า 2 จาก 2)" }));
  expect(screen.getByText("หน้า 1 · ส่งออกหน้านี้เป็น")).toBeInTheDocument();
});

test("selected missing clean asset fails visibly without saving or translated fallback", async () => {
  const { saveBlob } = await import("@/lib/export/saveLocation");
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [{ url: ORIGINAL_URL, name: PAGE_NAME, exportSource: "clean" }], currentPage: 0 }) } as never);
  vi.mocked(useCleaning).mockReturnValue({ ...cleaningMockState, resultsByPage: new Map() } as never);
  await renderRestoredWorkspace();
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "รูปภาพหน้านี้" }));
  await screen.findByText("พบร่องรอยต้องตรวจในภาพพื้นหลัง");
  expect(screen.getByRole("button", { name: "ยืนยันทุกหน้าและดำเนินการ Export" })).toBeDisabled();
  expect(saveBlob).not.toHaveBeenCalled();
  expect(downloadTranslatedImage).not.toHaveBeenCalled();
});

test("failed original fetch aborts ZIP instead of omitting the page", async () => {
  const { saveBlob } = await import("@/lib/export/saveLocation");
  vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [{ url: ORIGINAL_URL, name: PAGE_NAME, exportSource: "original" },
      { url: "blob:missing", name: "missing.png", exportSource: "original" }], currentPage: 0 }) } as never);
  await renderRestoredWorkspace();
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: /^ZIP$/ }));
  await waitFor(() => expect(translationMockState.setTranslationResult).toHaveBeenCalledWith(expect.stringContaining("โหลดภาพสำหรับส่งออกไม่สำเร็จ")));
  expect(saveBlob).not.toHaveBeenCalled();
});

test.each(["ยกเลิก", "ไปที่หน้านี้"])("clean review keeps only cleaning warning and %s releases page navigation", async (action) => {
  const second = "second-page";
  vi.mocked(useCleaning).mockReturnValue({ ...cleaningMockState,
    resultsByPage: new Map([[second, { ...cleaningResult, regions: [{ ...cleaningResult.regions[0], status: "needs_review" }] }]]) } as never);
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [{ url: ORIGINAL_URL, name: PAGE_NAME, exportSource: "original" },
      { url: second, name: "second.png", exportSource: "clean" }], currentPage: 0 }),
    bubbleCacheRef: { current: new Map([[second, [{ needsReview: true }]]]) } } as never);
  await renderRestoredWorkspace();
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: /^ZIP$/ }));
  await screen.findByText("มีหน้าที่ต้องได้รับการยืนยันก่อน Export");
  expect(screen.getByText("การคลีนไม่แน่นอน")).toBeInTheDocument();
  expect(screen.queryByText("คำแปลควรตรวจสอบ")).not.toBeInTheDocument();
  expect(scanPageGeometry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: action }));
  if (action === "ยกเลิก") fireEvent.click(screen.getByRole("button", { name: "หน้าถัดไป (หน้า 2 จาก 2)" }));
  expect(screen.getByText("หน้า 2 · ส่งออกหน้านี้เป็น")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" })).toBeEnabled();
});

test("strip export keeps source selection locked until its image file is saved", async () => {
  const { saveBlob } = await import("@/lib/export/saveLocation");
  const loaded: string[] = [];
  vi.stubGlobal("Image", class {
    naturalWidth = 10; naturalHeight = 10; onload: (() => void) | null = null;
    set src(value: string) { loaded.push(value); queueMicrotask(() => this.onload?.()); }
  });
  const context = { drawImage: vi.fn() };
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  let completeImage!: BlobCallback;
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => { completeImage = callback; });
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [{ url: ORIGINAL_URL, name: PAGE_NAME, exportSource: "original" }], currentPage: 0 }) } as never);
  try {
    await renderRestoredWorkspace();
    fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Strip/ }));
    await waitFor(() => expect(toBlob).toHaveBeenCalled());
    expect(loaded).toContain(ORIGINAL_URL);
    expect(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" })).toBeDisabled();
    await act(async () => { completeImage(new Blob(["strip"], { type: "image/jpeg" })); });
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" })).toBeEnabled());
  } finally { getContext.mockRestore(); toBlob.mockRestore(); vi.unstubAllGlobals(); }
});

test("export report labels chosen originals without an untranslated warning", async () => {
  await renderRestoredWorkspace();
  fireEvent.change(screen.getByRole("combobox", { name: "ส่งออกหน้านี้เป็น" }), { target: { value: "original" } });
  fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "รายงานก่อนส่งออก" }));
  const report = await screen.findByRole("dialog", { name: "รายงานก่อนส่งออก" });
  expect(within(report).getByText("ต้นฉบับ")).toBeInTheDocument();
  expect(report).not.toHaveTextContent("ยังไม่แปล");
});

test("manual export report cannot release the snapshot during a deferred source fetch", async () => {
  let finishFetch!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finishFetch = resolve; }));
  vi.mocked(useTranslation).mockReturnValue({ ...translationMockState,
    restoreSavedSession: vi.fn().mockResolvedValue({ pages: [{ url: "blob:deferred", name: PAGE_NAME, exportSource: "original" },
      { url: "second-page", name: "second.png", exportSource: "original" }], currentPage: 0 }) } as never);
  await renderRestoredWorkspace();
  fireEvent.click(screen.getAllByRole("button", { name: "ส่งออก" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: /^ZIP$/ }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("blob:deferred"));
  try {
    const toolsButton = screen.getAllByRole("button", { name: "เครื่องมือ" })[0];
    expect(toolsButton).toBeDisabled();
    fireEvent.click(toolsButton);
    expect(screen.queryByRole("menuitem", { name: "รายงานก่อนส่งออก" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "หน้าถัดไป (หน้า 2 จาก 2)" }));
    expect(screen.getByText("หน้า 1 · ส่งออกหน้านี้เป็น")).toBeInTheDocument();
  } finally {
    await act(async () => { finishFetch({ ok: false } as Response); });
  }
});

test("advanced tools organize-all option triggers auto-organization across pages", async () => {
  const dummyBubble = { id: "b1", originalText: "こんにちは", text: "สวัสดี", box: [10, 10, 100, 50] };
  vi.mocked(useTranslation).mockReturnValue({
    ...translationMockState,
    bubbleCacheRef: { current: new Map([[ORIGINAL_URL, [dummyBubble]]]) },
    restoreSavedSession: vi.fn().mockResolvedValue({
      pages: [{ url: ORIGINAL_URL, name: PAGE_NAME }],
      currentPage: 0,
    }),
  } as never);

  await renderRestoredWorkspace();

  const toolsTrigger = screen.getAllByRole("button", { name: "เครื่องมือ" })[0];
  fireEvent.click(toolsTrigger);

  const organizeAllItem = await screen.findByRole("menuitem", { name: "จัดระเบียบคำแปลทุกหน้า" });
  await act(async () => {
    fireEvent.click(organizeAllItem);
  });

  expect(autoOrganizePageBubbles).toHaveBeenCalled();
});

test("batch translate book runs auto-organization after batch translation completes", async () => {
  const dummyBubble = { id: "b1", originalText: "こんにちは", text: "สวัสดี", box: [10, 10, 100, 50] };
  const bubbleMap = new Map([[ORIGINAL_URL, [dummyBubble]]]);
  const mockHandleTranslateAll = vi.fn().mockImplementation(async () => {
    bubbleMap.set(ORIGINAL_URL, [dummyBubble]);
  });

  vi.mocked(useTranslation).mockReturnValue({
    ...translationMockState,
    handleTranslateAll: mockHandleTranslateAll,
    bubbleCacheRef: { current: bubbleMap },
    restoreSavedSession: vi.fn().mockResolvedValue({
      pages: [{ url: ORIGINAL_URL, name: PAGE_NAME }],
      currentPage: 0,
    }),
  } as never);

  await renderRestoredWorkspace();

  const toolsTrigger = screen.getAllByRole("button", { name: "เครื่องมือ" })[0];
  fireEvent.click(toolsTrigger);

  const translateBookItem = await screen.findByRole("menuitem", { name: /^แปลทั้งเล่ม$/ });
  await act(async () => {
    fireEvent.click(translateBookItem);
  });

  expect(mockHandleTranslateAll).toHaveBeenCalled();
  expect(autoOrganizePageBubbles).toHaveBeenCalled();
});

