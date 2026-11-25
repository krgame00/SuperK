import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacePage from "@/src/app/page";
import { applyTranslationOverlay, type TranslatedBubble } from "@/lib/translationOverlay";
import { AUTO_MODEL_PREFERENCE, type ModelPreference } from "@/lib/translation/modelPreference";

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
  Toaster: () => null,
}));

let mockTranslationResult: string | null = null;
let mockModelPreference: ModelPreference = AUTO_MODEL_PREFERENCE;
let mockIsTranslating = false;
const cancelTranslateAllMock = vi.fn();
const setModelPreferenceMock = vi.fn();
const setTranslationResultMock = vi.fn((val: any) => {
  mockTranslationResult = typeof val === "function" ? val(mockTranslationResult) : val;
});

vi.mock("@/hooks/useCleaning", () => ({
  useCleaning: () => ({
    cleanPage: vi.fn(),
    cleanCurrentPage: vi.fn(async () => {}),
    retryRegion: vi.fn(),
    currentResult: null,
    progress: null,
    error: null,
    resultsByPage: new Map(),
  }),
}));

vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({
    targetLang: "Thai",
    setTargetLang: vi.fn(),
    sourceLang: "auto",
    setSourceLang: vi.fn(),
    modelPreference: mockModelPreference,
    setModelPreference: setModelPreferenceMock,
    textStyle: {
      fontFamily: "Itim, sans-serif",
      textColor: "#000000",
      textOutline: "#FFFFFF",
      fontSizeMultiplier: 1.0,
    },
    setTextStyle: vi.fn(),
    nsfwBypassMode: false,
    setNsfwBypassMode: vi.fn(),
    isTranslating: mockIsTranslating,
    setIsTranslating: vi.fn(),
    translationResult: mockTranslationResult,
    setTranslationResult: setTranslationResultMock,
    showTranslate: false,
    setShowTranslate: vi.fn(),
    activeBubbles: [],
    setActiveBubbles: vi.fn(),
    userApiKey: "",
    setUserApiKey: vi.fn(),
    restoreSavedSession: vi.fn(async () => ({
      pages: [{ url: "data:image/png;base64,TEST", name: "test-page.png" }],
      currentPage: 0,
      bubbleCache: new Map(),
      translatedImageCache: new Map(),
    })),
    clearSavedSession: vi.fn(),
    bubbleCacheRef: { current: new Map() },
    translatedImageCacheRef: { current: new Map() },
    handleTranslate: vi.fn(),
    handleTranslateAll: vi.fn(),
    cancelTranslation: vi.fn(),
    cancelTranslateAll: cancelTranslateAllMock,
    saveRevision: 0,
    downloadTranslatedImage: vi.fn(),
  }),
}));

describe("WorkflowMessage Notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTranslationResult = null;
    mockModelPreference = AUTO_MODEL_PREFERENCE;
    mockIsTranslating = false;
    (document as any).fonts = {
      load: vi.fn().mockResolvedValue([]),
    };
  });

  it("renders workflowMessage when translationResult is present and dismisses on click", () => {
    mockTranslationResult = "✅ แปลสำเร็จ!";
    render(<WorkspacePage />);

    const toast = screen.getByRole("status");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("✅ แปลสำเร็จ!");

    // Clicking toast dismisses it
    fireEvent.click(toast);
    expect(setTranslationResultMock).toHaveBeenCalledWith(null);
  });

  it("uses top offset class when toolbar is at top to avoid covering toolbar buttons", () => {
    mockTranslationResult = "ข้อความแจ้งเตือน";
    render(<WorkspacePage />);

    const toast = screen.getByRole("status");
    // Should NOT be top-16 which directly overlaps top toolbar, and should clear PageFilmstrip (bottom-32 sm:bottom-34)
    expect(toast.className).not.toContain("top-16");
    expect(toast.className).toMatch(/top-24|top-20|bottom-32/);
  });

  it("offers an explicit Auto switch on a Manual translation failure", () => {    mockModelPreference = { engine: "gemini", model: "gemini-manual" };
    mockTranslationResult = "แปลไม่สำเร็จ: โมเดลที่เลือกไม่พร้อมใช้งาน";
    render(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนเป็น Auto" }));
    expect(setModelPreferenceMock).toHaveBeenCalledWith(AUTO_MODEL_PREFERENCE);
  });

  it("shows a cancel button while a translation or checker run is in flight", () => {
    mockIsTranslating = true;
    mockTranslationResult = "กำลังตรวจและเติมคำแปลที่ตกหล่น… (จุด 1/2 · 0:42)";
    render(<WorkspacePage />);

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("กำลังตรวจและเติมคำแปลที่ตกหล่น…");

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(cancelTranslateAllMock).toHaveBeenCalledTimes(1);
    // The pill must not also dismiss itself when the cancel button is used.
    expect(setTranslationResultMock).not.toHaveBeenCalledWith(null);
  });

  it("hides the cancel button when no run is in flight", () => {
    mockIsTranslating = false;
    mockTranslationResult = "✅ แปลสำเร็จ!";
    render(<WorkspacePage />);
    expect(screen.queryByRole("button", { name: "ยกเลิก" })).toBeNull();
  });

  it("does not emit stuck translation overlay messages during applyTranslationOverlay", async () => {
    const dummyContainer = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 500 },
      naturalHeight: { configurable: true, value: 500 },
    });
    dummyContainer.appendChild(image);
    document.body.appendChild(dummyContainer);

    const setResultSpy = vi.fn();
    const bubble: TranslatedBubble = {
      box: [10, 10, 100, 100],
      t: "ข้อความทดสอบ",
    };

    await applyTranslationOverlay(
      [bubble],
      "single",
      0,
      setResultSpy,
      undefined,
      { current: { fontFamily: "Itim, sans-serif", textColor: "#000", textOutline: "#fff", fontSizeMultiplier: 1 } },
      dummyContainer,
    );

    // Ensure "วางข้อความแปลเสร็จเรียบร้อย!" was NEVER emitted
    expect(setResultSpy).not.toHaveBeenCalledWith("✨ วางข้อความแปลเสร็จเรียบร้อย!");
    dummyContainer.remove();
  });
});
