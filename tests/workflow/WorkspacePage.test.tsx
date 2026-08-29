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
let handleTranslate: ReturnType<typeof vi.fn>;

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
  vi.mocked(useTranslation).mockReturnValue({
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
  } as never);
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

  test("mask retry invalidates stale translation and selects clean", async () => {
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
    expect(invalidatePageTranslation).toHaveBeenCalledWith(ORIGINAL_URL);
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
    fireEvent.keyDown(window, { key: " " });
    expect(toolbar().getAttribute("data-layer")).toBe("translated");

    fireEvent.click(screen.getByTitle(/ต้นฉบับ|คำแปล/));
    expect(toolbar().getAttribute("data-layer")).toBe("original");

    fireEvent.click(screen.getByTitle(/ต้นฉบับ|คำแปล/));
    expect(toolbar().getAttribute("data-layer")).toBe("translated");
  });
});
