import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspaceDocumentManager } from "@/hooks/useWorkspaceDocumentManager";
import { pageBlobStore } from "@/lib/lifecycle/pageBlobStore";
import { workspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";

vi.mock("@/lib/lifecycle/pageBlobStore", () => ({
  pageBlobStore: {
    set: vi.fn(),
    delete: vi.fn(),
    getOrCreateObjectUrl: vi.fn((id: string) => `blob:mock-${id}`),
  },
}));

vi.mock("@/lib/lifecycle/workspaceResourceManager", () => ({
  workspaceResourceManager: {
    updateNavigation: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("react-hot-toast", () => {
  const toastMock = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  });
  return {
    default: toastMock,
    toast: toastMock,
  };
});

vi.mock("@/lib/projectStore", () => ({
  exportPortableProjectBundle: vi.fn(),
  importPortableProjectBundle: vi.fn(),
}));

vi.mock("@/lib/customFonts", () => ({
  registerCustomFontFromFile: vi.fn(),
}));

describe("useWorkspaceDocumentManager", () => {
  let exportSnapshotRef: { current: any };
  let sessionBridgeRef: { current: any };

  beforeEach(() => {
    vi.clearAllMocks();
    exportSnapshotRef = { current: null };
    sessionBridgeRef = {
      current: {
        restoreSavedSession: vi.fn().mockResolvedValue(null),
        clearSavedSession: vi.fn().mockResolvedValue(undefined),
        setActiveBubbles: vi.fn(),
        setWorkspaceLayer: vi.fn(),
        inspectLegacyTargets: vi.fn().mockReturnValue([]),
        setLegacyTargetPages: vi.fn(),
      },
    };
  });

  it("initializes with empty pages and default document state", () => {
    const { result } = renderHook(() =>
      useWorkspaceDocumentManager({
        exportSnapshotRef,
        sessionBridgeRef,
      }),
    );

    expect(result.current.pages).toEqual([]);
    expect(result.current.currentPage).toBe(0);
    expect(result.current.isDragging).toBe(false);
    expect(result.current.isImporting).toBe(false);
    expect(result.current.brokenPages.size).toBe(0);
    expect(result.current.savedSessionData).toBeNull();
  });

  it("handles deleting and removing pages with pageBlobStore cleanup and index clamping", () => {
    const { result } = renderHook(() =>
      useWorkspaceDocumentManager({
        exportSnapshotRef,
        sessionBridgeRef,
      }),
    );

    act(() => {
      result.current.setPages([
        { id: "p1", url: "blob:p1", name: "01.png" },
        { id: "p2", url: "blob:p2", name: "02.png" },
        { id: "p3", url: "blob:p3", name: "03.png" },
      ]);
      result.current.setCurrentPage(2);
    });

    expect(result.current.pages).toHaveLength(3);
    expect(result.current.currentPage).toBe(2);

    // Delete page at index 1
    act(() => {
      result.current.handleDeletePage(1);
    });

    expect(pageBlobStore.delete).toHaveBeenCalledWith("p2");
    expect(result.current.pages).toHaveLength(2);
    expect(result.current.pages.map((p) => p.id)).toEqual(["p1", "p3"]);
    // currentPage was 2, now clamped to 1 because index 1 was deleted before it
    expect(result.current.currentPage).toBe(1);

    // Remove page at index 1 (the remaining last page)
    act(() => {
      result.current.handleRemovePage(1);
    });

    expect(pageBlobStore.delete).toHaveBeenCalledWith("p3");
    expect(result.current.pages).toHaveLength(1);
    expect(result.current.currentPage).toBe(0);
  });

  it("handles reordering and clearing all pages", () => {
    const { result } = renderHook(() =>
      useWorkspaceDocumentManager({
        exportSnapshotRef,
        sessionBridgeRef,
      }),
    );

    act(() => {
      result.current.setPages([
        { id: "p1", url: "blob:p1", name: "01.png" },
        { id: "p2", url: "blob:p2", name: "02.png" },
      ]);
    });

    act(() => {
      result.current.handleReorderPages([
        { id: "p2", url: "blob:p2", name: "02.png" },
        { id: "p1", url: "blob:p1", name: "01.png" },
      ]);
    });

    expect(result.current.pages[0].id).toBe("p2");
    expect(result.current.pages[1].id).toBe("p1");

    act(() => {
      result.current.handleClearAllPages();
    });

    expect(result.current.pages).toEqual([]);
    expect(result.current.currentPage).toBe(0);
    expect(workspaceResourceManager.clear).toHaveBeenCalled();
    expect(sessionBridgeRef.current.clearSavedSession).toHaveBeenCalled();
  });

  it("tracks broken images and updates exportSource per page", () => {
    const { result } = renderHook(() =>
      useWorkspaceDocumentManager({
        exportSnapshotRef,
        sessionBridgeRef,
      }),
    );

    act(() => {
      result.current.setPages([
        { id: "p1", url: "blob:p1", name: "01.png" },
        { id: "p2", url: "blob:p2", name: "02.png" },
      ]);
    });

    act(() => {
      result.current.handleImageError("blob:p1");
    });
    expect(result.current.brokenPages.has("blob:p1")).toBe(true);

    act(() => {
      result.current.handlePageExportSourceChange(0, "clean");
    });
    expect(result.current.pages[0].exportSource).toBe("clean");
  });

  it("restores saved session on mount and restores session on demand", async () => {
    sessionBridgeRef.current.restoreSavedSession.mockResolvedValue({
      pages: [{ url: "blob:saved1", name: "saved.png" }],
      currentPage: 0,
      hasUnrecoverableSources: false,
      bubbleCache: new Map([["blob:saved1", [{ t: "คำแปล" }]]]),
    });

    const { result } = renderHook(() =>
      useWorkspaceDocumentManager({
        exportSnapshotRef,
        sessionBridgeRef,
      }),
    );

    // Wait for mount check
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.savedSessionData).toEqual({
      pages: [{ url: "blob:saved1", name: "saved.png" }],
      currentPage: 0,
      hasUnrecoverableSources: false,
    });

    // Execute restore
    await act(async () => {
      await result.current.handleRestoreSavedSession();
    });

    expect(result.current.pages).toHaveLength(1);
    expect(result.current.pages[0].url).toBe("blob:saved1");
    expect(result.current.savedSessionData).toBeNull();
    expect(sessionBridgeRef.current.setWorkspaceLayer).toHaveBeenCalledWith("translated");
  });

  it("handles drag and drop interactions", async () => {
    const { result } = renderHook(() =>
      useWorkspaceDocumentManager({
        exportSnapshotRef,
        sessionBridgeRef,
      }),
    );

    const mockDragOverEvent = {
      preventDefault: vi.fn(),
      dataTransfer: { types: ["Files"] },
    } as any;

    act(() => {
      result.current.handleDragOver(mockDragOverEvent);
    });
    expect(result.current.isDragging).toBe(true);

    const mockDragLeaveEvent = {
      preventDefault: vi.fn(),
      currentTarget: { contains: vi.fn().mockReturnValue(false) },
      relatedTarget: null,
    } as any;

    act(() => {
      result.current.handleDragLeave(mockDragLeaveEvent);
    });
    expect(result.current.isDragging).toBe(false);
  });

  it("exports project bundle as .superk file without .json extension", async () => {
    const { exportPortableProjectBundle } = await import("@/lib/projectStore");
    const toast = (await import("react-hot-toast")).default;
    (exportPortableProjectBundle as any).mockResolvedValueOnce({
      format: "superk-project-v1",
      pages: [{ id: "p1", url: "data:img1", name: "01.png" }],
    });

    const createObjectURLMock = vi.fn().mockReturnValue("blob:mock-project-url");
    const revokeObjectURLMock = vi.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;

    let clickedDownload = "";
    const clickMock = vi.fn(function (this: HTMLAnchorElement) {
      clickedDownload = this.download;
    });
    const origCreateElement = Document.prototype.createElement;
    const spy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = origCreateElement.call(document, tagName);
      if (tagName === "a") {
        el.click = clickMock as any;
      }
      return el;
    });

    try {
      const { result } = renderHook(() =>
        useWorkspaceDocumentManager({
          exportSnapshotRef,
          sessionBridgeRef,
        }),
      );

      act(() => {
        result.current.setPages([{ id: "p1", url: "blob:p1", name: "MyManga_01.png" }]);
      });

      await act(async () => {
        await result.current.handleExportProjectFile();
      });

      expect(exportPortableProjectBundle).toHaveBeenCalled();
      expect(clickedDownload).toBe("SuperK_MyManga.superk");
      expect(clickedDownload.endsWith(".superk")).toBe(true);
      expect(clickedDownload.endsWith(".json")).toBe(false);
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("(.superk)"),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("accepts .superk in handleImportProjectFile file dialog", async () => {
    let createdInput: HTMLInputElement | null = null;
    const origCreateElement = Document.prototype.createElement;
    const spy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = origCreateElement.call(document, tagName);
      if (tagName === "input") {
        createdInput = el as HTMLInputElement;
      }
      return el;
    });

    try {
      const { result } = renderHook(() =>
        useWorkspaceDocumentManager({
          exportSnapshotRef,
          sessionBridgeRef,
        }),
      );

      act(() => {
        result.current.handleImportProjectFile();
      });

      expect(createdInput).not.toBeNull();
      const inputEl = createdInput as unknown as HTMLInputElement;
      expect(inputEl.type).toBe("file");
      expect(inputEl.accept).toContain(".superk");
      expect(inputEl.accept.startsWith(".superk,")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("processes dropped .superk project file directly into workspace", async () => {
    const { importPortableProjectBundle } = await import("@/lib/projectStore");
    const toast = (await import("react-hot-toast")).default;
    (importPortableProjectBundle as any).mockResolvedValueOnce({
      format: "superk-project-v1",
      pages: [{ id: "p1", url: "blob:restored1", name: "01.png" }],
      currentPage: 0,
      bubbleCache: new Map(),
      pageTargetCache: new Map(),
      translatedImageCache: new Map(),
    });

    sessionBridgeRef.current.restoreSavedSession.mockResolvedValue({
      pages: [{ id: "p1", url: "blob:restored1", name: "01.png" }],
      currentPage: 0,
      hasUnrecoverableSources: false,
    });

    const { result } = renderHook(() =>
      useWorkspaceDocumentManager({
        exportSnapshotRef,
        sessionBridgeRef,
      }),
    );

    const fakeFile = new File(
      ['{"format":"superk-project-v1"}'],
      "SuperK_Project.superk",
      { type: "application/octet-stream" },
    );

    await act(async () => {
      await result.current.processFiles([fakeFile]);
    });

    expect(importPortableProjectBundle).toHaveBeenCalled();
    expect(result.current.pages).toHaveLength(1);
    expect(result.current.pages[0].url).toBe("blob:restored1");
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("เปิดโปรเจกต์สำเร็จ"),
    );
  });

  it("processes dropped .ttf/.otf custom font file directly into font store", async () => {
    const { registerCustomFontFromFile } = await import("@/lib/customFonts");
    const toast = (await import("react-hot-toast")).default;
    (registerCustomFontFromFile as any).mockResolvedValueOnce({
      id: "custom-font-manga-shonen",
      familyName: "Manga Shonen",
      cssValue: "Manga Shonen, sans-serif",
      fileName: "Manga-Shonen.ttf",
      mimeType: "font/ttf",
      byteLength: 1024,
      createdAt: Date.now(),
    });

    const { result } = renderHook(() =>
      useWorkspaceDocumentManager({
        exportSnapshotRef,
        sessionBridgeRef,
      }),
    );

    const fontFile = new File([new ArrayBuffer(1024)], "Manga-Shonen.ttf", {
      type: "font/ttf",
    });

    await act(async () => {
      await result.current.processFiles([fontFile]);
    });

    expect(registerCustomFontFromFile).toHaveBeenCalledWith(fontFile);
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Manga Shonen"),
    );
    // Should not add font as an image page
    expect(result.current.pages).toHaveLength(0);
  });
});
