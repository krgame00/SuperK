import {
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
import { downloadTranslatedImage } from "@/lib/translationOverlay";

vi.mock("@/hooks/useCleaning");
vi.mock("@/hooks/useTranslation");
vi.mock("react-hot-toast", () => ({
  default: vi.fn(),
  Toaster: () => null,
}));
vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(),
  downloadTranslatedImage: vi.fn(),
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
    },
  ],
};

let cleanCurrentPage: ReturnType<typeof vi.fn>;
let retryRegion: ReturnType<typeof vi.fn>;
let invalidatePageTranslation: ReturnType<typeof vi.fn>;
let refreshPageTranslation: ReturnType<typeof vi.fn>;
let handleTranslate: ReturnType<typeof vi.fn>;
let translationMockState: Record<string, unknown>;

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
  render(<WorkspacePage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /คืนค่างานเดิม/ }),
  );
  await waitFor(() => expect(mainImage()).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanCurrentPage = vi.fn().mockResolvedValue(cleaningResult);
  retryRegion = vi.fn().mockResolvedValue(cleaningResult);
  invalidatePageTranslation = vi.fn();
  refreshPageTranslation = vi.fn().mockResolvedValue(undefined);
  handleTranslate = vi.fn().mockResolvedValue(true);

  vi.mocked(useCleaning).mockReturnValue({
    cleanPage: vi.fn().mockResolvedValue(cleaningResult),
    cleanCurrentPage,
    retryRegion,
    cancelPolling: vi.fn(),
    currentResult: cleaningResult,
    progress: undefined,
    error: undefined,
    resultsByPage: new Map([[ORIGINAL_URL, cleaningResult]]),
  } as never);
  translationMockState = {
    targetLang: "Thai",
    setTargetLang: vi.fn(),
    sourceLang: "auto",
    setSourceLang: vi.fn(),
    modelPreference: "auto",
    setModelPreference: vi.fn(),
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
        translatedText: "สวัสดี",
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.1,
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
    workflowPhase: null,
    batchFailures: [],
    invalidatePageTranslation,
    refreshPageTranslation,
    scanTranslatedPages: vi.fn(() => []),
    inspectTranslatedPages: vi.fn(() => []),
    getPageSignature: vi.fn(() => "rev-0"),
    getPageRevision: vi.fn(() => 0),
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
    const bubble = { id: "bubble-1", t: "ข้อความยาว", box: [100, 100, 200, 300] };
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
    await waitFor(() => expect(downloadTranslatedImage).toHaveBeenCalled());
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
    await waitFor(() => expect(downloadTranslatedImage).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "รายงานก่อนส่งออก" })).toBeNull();
  });

  test("book export offers progress and early continuation without a late popup", async () => {
    let finishScan!: (value: { findings: [] }) => void;
    vi.mocked(scanPageGeometry).mockReturnValue(new Promise((resolve) => { finishScan = resolve; }));
    vi.mocked(useTranslation).mockReturnValue({
      ...translationMockState,
      bubbleCacheRef: { current: new Map([[ORIGINAL_URL, [
        { id: "bubble-1", t: "สวัสดี", box: [100, 100, 200, 300] },
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
    fireEvent.click(await screen.findByRole("menuitem", { name: format }));
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
        { id: "bubble-1", t: "สวัสดี", box: [100, 100, 200, 300] },
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
