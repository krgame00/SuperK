import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import type { CleaningToolbar } from "@/components/cleaning/CleaningToolbar";
import { beforeEach, expect, test, vi } from "vitest";

import { useCleaning } from "@/hooks/useCleaning";
import { useTranslation } from "@/hooks/useTranslation";
import WorkspacePage from "@/src/app/page";
import { scanPageGeometry } from "@/lib/export/readabilityScan";
import toast from "react-hot-toast";

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
  MaskEditor: vi.fn(() => <div role="dialog" aria-label="Mask editor" />),
}));

const ORIGINAL_URL = "data:image/png;base64,ORIGINAL";
const PAGE_NAME = "page-one.png";

const cleaningResult = {
  width: 100,
  height: 100,
  pageId: ORIGINAL_URL,
  cleanUrl: "data:image/png;base64,CLEAN",
  maskUrl: "data:image/png;base64,MASK",
  reviewMaskUrl: "data:image/png;base64,REVIEW",
  protectedMaskUrl: "data:image/png;base64,PROTECTED",
  diffUrl: "data:image/png;base64,DIFF",
  regions: [],
};

let translationMockState: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  translationMockState = {
    targetLang: "Thai",
    setTargetLang: vi.fn(),
    pageTargetCacheRef: { current: new Map() },
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
      pages: [{ url: ORIGINAL_URL, name: PAGE_NAME }],
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
    getPageRevision: vi.fn(() => 0),
    cacheRevision: 0,
    // Ticket 03 surfaces.
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
  };
  vi.mocked(useCleaning).mockReturnValue({
    cleanPage: vi.fn().mockResolvedValue(cleaningResult),
    cleanCurrentPage: vi.fn().mockResolvedValue(cleaningResult),
    retryRegion: vi.fn().mockResolvedValue(cleaningResult),
    cancelPolling: vi.fn(),
    currentResult: cleaningResult,
    progress: undefined,
    error: undefined,
    resultsByPage: new Map([[ORIGINAL_URL, cleaningResult]]),
  } as never);
  vi.mocked(useTranslation).mockReturnValue(translationMockState as never);
  vi.mocked(scanPageGeometry).mockResolvedValue({ findings: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({}),
      blob: vi.fn().mockResolvedValue(new Blob(["original"], { type: "image/png" })),
    }),
  );
});

async function restoreWorkspaceWith(overrides: Record<string, unknown>) {
  Object.assign(translationMockState, overrides);
  const rendered = render(<WorkspacePage />);
  const restoreButton = await screen.findByRole("button", { name: /คืนค่างานเดิม/ });
  await act(async () => {
    fireEvent.click(restoreButton);
  });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /คืนค่างานเดิม/ })).not.toBeInTheDocument(),
  );
  return rendered;
}

test("restored legacy projects confirm their target once with Thai suggested", async () => {
  const confirmLegacyTarget = vi.fn(() => 1);
  await restoreWorkspaceWith({
    inspectLegacyTargets: vi.fn(() => [{ pageUrl: ORIGINAL_URL, pageIndex: 0 }]),
    confirmLegacyTarget,
  });

  const dialog = screen.getByRole("dialog", { name: /ยืนยันภาษาปลายทางของงานเก่า/ });
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByText(/หน้า 1/)).toBeInTheDocument();
  expect(within(dialog).getAllByText(/ภาษาไทย/).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: /ยืนยันใช้ภาษา/ }));
  expect(confirmLegacyTarget).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("dialog", { name: /ยืนยันภาษาปลายทางของงานเก่า/ }),
  ).not.toBeInTheDocument();
});

test("legacy target confirmation can be postponed without relabelling pages", async () => {
  await restoreWorkspaceWith({
    inspectLegacyTargets: vi.fn(() => [{ pageUrl: ORIGINAL_URL, pageIndex: 0 }]),
    confirmLegacyTarget: vi.fn(() => 0),
  });

  fireEvent.click(screen.getByRole("button", { name: /ยืนยันภายหลัง/ }));
  expect(screen.queryByRole("dialog", { name: /ยืนยันภาษาปลายทางของงานเก่า/ })).not.toBeInTheDocument();
  expect(translationMockState.confirmLegacyTarget).not.toHaveBeenCalled();
});

test("the scan action opens an actionable review list with human confirmation and whole-book repair", async () => {
  const confirmPointReview = vi.fn(() => true);
  const repairWholeBook = vi.fn().mockResolvedValue({
    pagesRepaired: 1,
    pointsRepaired: 1,
    cancelled: false,
    unresolved: [],
    skipped: [],
  });
  await restoreWorkspaceWith({
    confirmPointReview,
    repairWholeBook,
    inspectReviewIssues: vi.fn(() => [
      {
        pageUrl: ORIGINAL_URL,
        pageIndex: 0,
        pageTotal: 2,
        targetId: "th",
        targetUnconfirmed: false,
        scriptIssues: [
          {
            index: 0,
            pointId: "1",
            kind: "script",
            hasSource: true,
            humanConfirmable: false,
            characters: "U+05DE",
          },
        ],
        unverified: [
          {
            index: 1,
            pointId: "2",
            kind: "unverified",
            hasSource: true,
            humanConfirmable: true,
            status: "unavailable",
          },
        ],
      },
    ]),
  });

  fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "ตรวจคำแปลทั้งเล่ม" }));

  const dialog = await screen.findByRole("dialog", { name: /รายการตรวจคำแปล/ });
  expect(dialog).toBeInTheDocument();
  // The script failure shows its offending characters and offers no confirmation.
  expect(screen.getByText(/U\+05DE/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /ยืนยันจุดที่ 1/ })).not.toBeInTheDocument();
  // A source-backed point whose script passes can be explicitly human-confirmed.
  fireEvent.click(screen.getByRole("button", { name: /ยืนยันจุดที่ 2/ }));
  expect(confirmPointReview).toHaveBeenCalledWith(ORIGINAL_URL, 1);

  fireEvent.click(screen.getByRole("button", { name: /แก้ตัวอักษรปนทั้งเล่ม/ }));
  await waitFor(() => expect(repairWholeBook).toHaveBeenCalledTimes(1));
});

test("postponed legacy confirmation reopens from the scan before the review list", async () => {
  const confirmLegacyTarget = vi.fn(() => 1);
  await restoreWorkspaceWith({
    inspectLegacyTargets: vi.fn(() => [{ pageUrl: ORIGINAL_URL, pageIndex: 0 }]),
    confirmLegacyTarget,
  });

  fireEvent.click(screen.getByRole("button", { name: /ยืนยันภายหลัง/ }));
  expect(
    screen.queryByRole("dialog", { name: /ยืนยันภาษาปลายทางของงานเก่า/ }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "ตรวจคำแปลทั้งเล่ม" }));

  // The scan must re-open the one-time confirmation instead of stranding the
  // postponed pages behind an unactionable review badge.
  const dialog = await screen.findByRole("dialog", {
    name: /ยืนยันภาษาปลายทางของงานเก่า/,
  });
  expect(dialog).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: /ยืนยันใช้ภาษา/ }));
  expect(confirmLegacyTarget).toHaveBeenCalledTimes(1);
});

test("the review dialog offers a confirm action next to the unconfirmed-target badge", async () => {
  const confirmLegacyTarget = vi.fn(() => 1);
  await restoreWorkspaceWith({
    confirmLegacyTarget,
    inspectReviewIssues: vi.fn(() => [
      {
        pageUrl: ORIGINAL_URL,
        pageIndex: 0,
        pageTotal: 2,
        targetId: "th",
        targetUnconfirmed: true,
        scriptIssues: [],
        unverified: [],
      },
    ]),
  });

  fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "ตรวจคำแปลทั้งเล่ม" }));

  const dialog = await screen.findByRole("dialog", { name: /รายการตรวจคำแปล/ });
  expect(within(dialog).getByText("ยืนยันภาษาของหน้าก่อน")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: /ยืนยันภาษา/ }));
  expect(confirmLegacyTarget).toHaveBeenCalledTimes(1);
});

test("the whole-book repair toast surfaces pages skipped for unconfirmed targets", async () => {
  const repairWholeBook = vi.fn().mockResolvedValue({
    pagesRepaired: 0,
    pointsRepaired: 2,
    cancelled: false,
    unresolved: [],
    skipped: [{ pageIndex: 1, pageUrl: "url-2", reason: "target-unconfirmed" }],
  });
  await restoreWorkspaceWith({
    repairWholeBook,
    inspectReviewIssues: vi.fn(() => [
      {
        pageUrl: ORIGINAL_URL,
        pageIndex: 0,
        pageTotal: 2,
        targetId: "th",
        targetUnconfirmed: true,
        scriptIssues: [],
        unverified: [],
      },
    ]),
  });

  fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "ตรวจคำแปลทั้งเล่ม" }));

  fireEvent.click(screen.getByRole("button", { name: /แก้ตัวอักษรปนทั้งเล่ม/ }));
  await waitFor(() => expect(repairWholeBook).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining("ข้าม 1 หน้า (ยืนยันภาษาไม่ครบ)"),
      expect.anything(),
    ),
  );
});

test("a cancelled whole-book repair still reports its skipped pages in the toast", async () => {
  const repairWholeBook = vi.fn().mockResolvedValue({
    pagesRepaired: 1,
    pointsRepaired: 2,
    cancelled: true,
    unresolved: [],
    skipped: [{ pageIndex: 1, pageUrl: "url-2", reason: "target-unconfirmed" }],
  });
  await restoreWorkspaceWith({
    repairWholeBook,
    inspectReviewIssues: vi.fn(() => [
      {
        pageUrl: ORIGINAL_URL,
        pageIndex: 0,
        pageTotal: 2,
        targetId: "th",
        targetUnconfirmed: true,
        scriptIssues: [],
        unverified: [],
      },
    ]),
  });

  fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "ตรวจคำแปลทั้งเล่ม" }));

  fireEvent.click(screen.getByRole("button", { name: /แก้ตัวอักษรปนทั้งเล่ม/ }));
  await waitFor(() => expect(repairWholeBook).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining("ยกเลิกการแก้ทั้งเล่ม"),
      expect.anything(),
    ),
  );
  expect(toast).toHaveBeenCalledWith(
    expect.stringContaining("ข้าม 1 หน้า (ยืนยันภาษาไม่ครบ)"),
    expect.anything(),
  );
});

test("a whole-book repair failure surfaces an error toast instead of an unhandled rejection", async () => {
  const repairWholeBook = vi
    .fn()
    .mockRejectedValue(new Error("repair boom"));
  await restoreWorkspaceWith({
    repairWholeBook,
    inspectReviewIssues: vi.fn(() => [
      {
        pageUrl: ORIGINAL_URL,
        pageIndex: 0,
        pageTotal: 2,
        targetId: "th",
        targetUnconfirmed: false,
        scriptIssues: [
          {
            index: 0,
            pointId: "1",
            kind: "script",
            hasSource: true,
            humanConfirmable: false,
            characters: "U+05DE",
          },
        ],
        unverified: [],
      },
    ]),
  });

  fireEvent.click(screen.getAllByRole("button", { name: "เครื่องมือ" })[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "ตรวจคำแปลทั้งเล่ม" }));

  fireEvent.click(screen.getByRole("button", { name: /แก้ตัวอักษรปนทั้งเล่ม/ }));
  await waitFor(() => expect(repairWholeBook).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining("repair boom"),
      expect.anything(),
    ),
  );
});

test("legacy confirmation labels follow the actual target language", async () => {
  await restoreWorkspaceWith({
    targetLang: "English",
    inspectLegacyTargets: vi.fn(() => [{ pageUrl: ORIGINAL_URL, pageIndex: 0 }]),
    confirmLegacyTarget: vi.fn(() => 1),
  });

  const dialog = screen.getByRole("dialog", { name: /ยืนยันภาษาปลายทางของงานเก่า/ });
  const confirmButton = within(dialog).getByRole("button", {
    name: "ยืนยันใช้ภาษา English",
  });
  expect(confirmButton).toBeInTheDocument();

  fireEvent.click(confirmButton);
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      "✅ ยืนยันใช้ภาษา English กับ 1 หน้า",
      expect.anything(),
    ),
  );
});
