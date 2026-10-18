"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type SetStateAction,
  type ChangeEvent,
  type DragEvent,
  type MutableRefObject,
} from "react";
import JSZip from "jszip";
import { blobToDataUrl } from "@/lib/projectStore";
import { pageBlobStore } from "@/lib/lifecycle/pageBlobStore";
import { workspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";
import { deriveProjectExportName } from "@/lib/export/exportManager";
import type { PageExportSource } from "@/lib/export/pageSource";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";
import type { LegacyTargetPage } from "@/hooks/useTranslation";

export interface SavedSessionData {
  pages: {
    url: string;
    name: string;
    originUrl?: string;
    unrecoverableSource?: boolean;
  }[];
  currentPage: number;
  hasUnrecoverableSources?: boolean;
}

export interface WorkspaceDocumentSessionBridge {
  restoreSavedSession?: () => Promise<{
    pages: WorkspaceExportPage[];
    currentPage: number;
    hasUnrecoverableSources?: boolean;
    bubbleCache?: Map<string, TranslatedBubble[]>;
    translatedImageCache?: Map<string, string>;
  } | null>;
  clearSavedSession?: () => Promise<void> | void;
  setActiveBubbles?: (bubbles: TranslatedBubble[]) => void;
  setWorkspaceLayer?: (layer: WorkspaceLayer) => void;
  inspectLegacyTargets?: () => LegacyTargetPage[];
  setLegacyTargetPages?: (pages: LegacyTargetPage[]) => void;
}

export interface UseWorkspaceDocumentManagerOptions {
  exportSnapshotRef: MutableRefObject<{
    pages: WorkspaceExportPage[];
    currentPage: number;
  } | null>;
  sessionBridgeRef: MutableRefObject<WorkspaceDocumentSessionBridge>;
}

export async function fetchExtensionPairingToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/extension/pair");
    if (!res.ok) return null;
    const data = (await res.json()) as { pairingToken?: unknown };
    return typeof data.pairingToken === "string" && data.pairingToken
      ? data.pairingToken
      : null;
  } catch {
    return null;
  }
}

export function useWorkspaceDocumentManager({
  exportSnapshotRef,
  sessionBridgeRef,
}: UseWorkspaceDocumentManagerOptions) {
  const [pages, setPages] = useState<WorkspaceExportPage[]>([]);
  const [currentPage, setCurrentPageState] = useState(0);

  const setCurrentPage = useCallback(
    (updater: SetStateAction<number>) => {
      if (!exportSnapshotRef.current) {
        setCurrentPageState(updater);
      }
    },
    [exportSnapshotRef],
  );

  const currentPageRef = useRef(currentPage);
  const pagesRef = useRef(pages);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const [confirmedPages, setConfirmedPagesState] = useState<Set<string>>(
    new Set(),
  );
  const confirmedPagesRef = useRef(confirmedPages);
  const setConfirmedPages = useCallback(
    (update: (previous: Set<string>) => Set<string>) => {
      const next = update(confirmedPagesRef.current);
      confirmedPagesRef.current = next;
      setConfirmedPagesState(next);
    },
    [],
  );

  const confirmedMissingTranslationsRef = useRef<Map<string, string>>(
    new Map(),
  );
  const [brokenPages, setBrokenPages] = useState<Set<string>>(new Set());

  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(
    null,
  );

  const [savedSessionData, setSavedSessionData] =
    useState<SavedSessionData | null>(null);

  // Sync workspace resource manager navigation
  useEffect(() => {
    if (pages.length > 0) {
      const pageIds = pages.map((p, idx) => p.id || `page_${idx}`);
      workspaceResourceManager.updateNavigation(pageIds, currentPage);
    }
  }, [pages, currentPage]);

  const pageUrls = useMemo(() => pages.map((p) => p.url), [pages]);
  const pageIds = useMemo(() => pages.map((p) => p.id), [pages]);
  const pageNames = useMemo(() => pages.map((p) => p.name), [pages]);

  // Check for saved IndexedDB session on mount
  useEffect(() => {
    const restoreFn = sessionBridgeRef.current?.restoreSavedSession;
    if (!restoreFn) return;
    void restoreFn().then((saved) => {
      if (saved && saved.pages && saved.pages.length > 0) {
        setSavedSessionData({
          pages: saved.pages,
          currentPage: saved.currentPage,
          hasUnrecoverableSources: saved.hasUnrecoverableSources,
        });
      }
    });
  }, [sessionBridgeRef]);

  // Check for extension workspace handoff parameter (?handoff=hnd_...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const handoffId = params.get("handoff");
    if (!handoffId) return;

    window.history.replaceState({}, document.title, window.location.pathname);

    (async () => {
      try {
        const pairingToken = await fetchExtensionPairingToken();
        const res = await fetch(
          `/api/extension/workspace/append?id=${encodeURIComponent(handoffId)}`,
          {
            headers: pairingToken
              ? { Authorization: `Bearer ${pairingToken}` }
              : undefined,
          },
        );
        if (!res.ok) return;
        const handoffData = await res.json();

        const [{ appendPageToProjectSession }, { verifyWorkspaceHandoff }] =
          await Promise.all([
            import("@/lib/projectStore"),
            import("@/lib/extension/workspaceHandoff"),
          ]);
        const verifiedHandoff = await verifyWorkspaceHandoff(handoffData);
        const appendRes = await appendPageToProjectSession({
          pageUrl: verifiedHandoff.pageUrl,
          name: handoffData.name || `Extension Page`,
          cleanUrl: handoffData.cleanUrl,
          bubbles: verifiedHandoff.bubbles,
          originUrl: handoffData.originUrl,
          readerImageUrl: verifiedHandoff.readerImageUrl,
          targetIdentity: verifiedHandoff.targetIdentity,
          sourceFingerprint: verifiedHandoff.sourceRevision,
        });

        const restoreFn = sessionBridgeRef.current?.restoreSavedSession;
        const restored = restoreFn ? await restoreFn() : null;
        if (restored && restored.pages.length > 0) {
          setPages(restored.pages);
          setCurrentPage(appendRes.pageIndex);
          setSavedSessionData(null);
          const pendingLegacy =
            sessionBridgeRef.current?.inspectLegacyTargets?.();
          if (pendingLegacy && pendingLegacy.length > 0) {
            sessionBridgeRef.current?.setLegacyTargetPages?.(pendingLegacy);
          }
        }
        const toast = (await import("react-hot-toast")).default;
        toast("✨ นำเข้าภาพจาก Chrome Extension เรียบร้อยแล้ว!", {
          duration: 2500,
        });
      } catch (err) {
        console.error("Failed to process extension handoff:", err);
      }
    })();
  }, [sessionBridgeRef, setCurrentPage]);

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || isImporting || exportSnapshotRef.current) return;

      setIsImporting(true);
      setImportStatusMessage("กำลังจัดเตรียมไฟล์...");

      try {
        const sorted = [...files].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );

        const newPages: {
          id?: string;
          url: string;
          name: string;
          originUrl?: string;
        }[] = [];
        let failureCount = 0;

        for (let fileIdx = 0; fileIdx < sorted.length; fileIdx++) {
          const file = sorted[fileIdx];
          const isArchive =
            file.type === "application/zip" ||
            file.type === "application/x-zip-compressed" ||
            file.name.toLowerCase().endsWith(".zip") ||
            file.name.toLowerCase().endsWith(".cbz");
          const isPdf =
            file.type === "application/pdf" ||
            file.name.toLowerCase().endsWith(".pdf");

          if (isArchive) {
            try {
              setImportStatusMessage(`กำลังแตกไฟล์ ZIP/CBZ: ${file.name}...`);
              const zip = new JSZip();
              const loadedZip = await zip.loadAsync(file);

              const zipFiles = Object.values(loadedZip.files).filter(
                (f) =>
                  !f.dir && f.name.match(/\.(jpg|jpeg|png|webp|gif)$/i),
              );
              zipFiles.sort((a, b) =>
                a.name.localeCompare(b.name, undefined, {
                  numeric: true,
                  sensitivity: "base",
                }),
              );

              if (zipFiles.length === 0) {
                const toast = (await import("react-hot-toast")).default;
                toast.error(`ไม่พบไฟล์รูปภาพใน ${file.name}`);
                failureCount++;
                continue;
              }

              for (let zIdx = 0; zIdx < zipFiles.length; zIdx++) {
                const zipFile = zipFiles[zIdx];
                setImportStatusMessage(
                  `กำลังอ่านไฟล์ ${file.name} (รูปที่ ${zIdx + 1}/${zipFiles.length})...`,
                );
                const ext = zipFile.name.split(".").pop()?.toLowerCase();
                const mimeType =
                  ext === "png"
                    ? "image/png"
                    : ext === "webp"
                      ? "image/webp"
                      : ext === "gif"
                        ? "image/gif"
                        : "image/jpeg";
                const rawBlob = await zipFile.async("blob");
                const blob = new Blob([rawBlob], { type: mimeType });
                const pageId = `page_zip_${Date.now()}_${fileIdx}_${zIdx}`;
                pageBlobStore.set(pageId, blob, mimeType);
                const durableUrl =
                  pageBlobStore.getOrCreateObjectUrl(pageId) ??
                  (await blobToDataUrl(blob));
                newPages.push({
                  id: pageId,
                  url: durableUrl,
                  name: zipFile.name,
                });
              }
            } catch (e) {
              console.error("Failed to extract zip/cbz", e);
              failureCount++;
              const toast = (await import("react-hot-toast")).default;
              toast.error(`ไม่สามารถเปิดไฟล์ ZIP/CBZ: ${file.name}`);
            }
          } else if (isPdf) {
            try {
              setImportStatusMessage(`กำลังเปิดไฟล์ PDF: ${file.name}...`);
              const pdfjsLib = await import("pdfjs-dist");
              if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
              }
              const arrayBuffer = await file.arrayBuffer();
              const pdf = await pdfjsLib.getDocument({ data: arrayBuffer })
                .promise;
              const numPages = pdf.numPages;

              for (let i = 1; i <= numPages; i++) {
                setImportStatusMessage(
                  `กำลังแปลงหน้า PDF: ${file.name} (หน้า ${i}/${numPages})...`,
                );
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement("canvas");
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext("2d");
                if (!ctx) continue;

                const renderParams = {
                  canvasContext: ctx,
                  viewport,
                } as unknown as Parameters<typeof page.render>[0];
                await page.render(renderParams).promise;
                const blob = await new Promise<Blob | null>((resolve) => {
                  canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95);
                });
                if (!blob) continue;
                const pageId = `page_pdf_${Date.now()}_${fileIdx}_${i}`;
                pageBlobStore.set(pageId, blob, "image/jpeg");
                const durableUrl =
                  pageBlobStore.getOrCreateObjectUrl(pageId) ??
                  (await blobToDataUrl(blob));
                newPages.push({
                  id: pageId,
                  url: durableUrl,
                  name: `${file.name.replace(".pdf", "")}_page${i}.jpg`,
                });
              }
            } catch (e) {
              console.error("Failed to parse PDF", e);
              failureCount++;
              const toast = (await import("react-hot-toast")).default;
              toast.error(`ไม่สามารถแปลงไฟล์ PDF: ${file.name}`);
            }
          } else if (file.type.startsWith("image/")) {
            setImportStatusMessage(
              `กำลังโหลดรูป: ${file.name} (${fileIdx + 1}/${sorted.length})...`,
            );
            const ext = file.name.split(".").pop()?.toLowerCase();
            const fallbackMime =
              ext === "jpg" || ext === "jpeg"
                ? "image/jpeg"
                : ext === "webp"
                  ? "image/webp"
                  : "image/png";
            const resolvedMime =
              file.type && file.type !== "application/octet-stream"
                ? file.type
                : fallbackMime;
            const typedBlob =
              file.type === resolvedMime
                ? file
                : new Blob([file], { type: resolvedMime });
            const pageId = `page_img_${Date.now()}_${fileIdx}`;
            pageBlobStore.set(pageId, typedBlob, resolvedMime);
            const durableUrl =
              pageBlobStore.getOrCreateObjectUrl(pageId) ??
              (await blobToDataUrl(typedBlob));
            newPages.push({ id: pageId, url: durableUrl, name: file.name });
          }
        }

        if (newPages.length > 0) {
          setPages((prev) => {
            const updated = [...prev, ...newPages];
            if (prev.length === 0) {
              setCurrentPage(0);
              sessionBridgeRef.current?.setActiveBubbles?.([]);
            }
            return updated;
          });
          const toast = (await import("react-hot-toast")).default;
          toast.success(`นำเข้าสำเร็จ ${newPages.length} หน้า`);
        } else if (failureCount > 0) {
          const toast = (await import("react-hot-toast")).default;
          toast.error("ไม่สามารถนำเข้าไฟล์ที่เลือกได้ กรุณาตรวจสอบรูปแบบไฟล์");
        }
      } finally {
        setIsImporting(false);
        setImportStatusMessage(null);
      }
    },
    [isImporting, exportSnapshotRef, setCurrentPage, sessionBridgeRef],
  );

  const handleImageUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      await processFiles(files);
      e.target.value = "";
    },
    [processFiles],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    const hasFiles =
      e.dataTransfer.types &&
      Array.from(e.dataTransfer.types).includes("Files");
    if (hasFiles) {
      e.preventDefault();
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        await processFiles(files);
      }
    },
    [processFiles],
  );

  const handleDeletePage = useCallback(
    (i: number) => {
      if (exportSnapshotRef.current) return;
      const targetPage = pagesRef.current[i];
      if (targetPage?.id) {
        pageBlobStore.delete(targetPage.id);
      }
      setPages((prev) => {
        const newPages = prev.filter((_, idx) => idx !== i);
        if (newPages.length === 0) setCurrentPage(0);
        else if (currentPageRef.current >= newPages.length)
          setCurrentPage(newPages.length - 1);
        else if (currentPageRef.current > i)
          setCurrentPage(currentPageRef.current - 1);
        return newPages;
      });
    },
    [exportSnapshotRef, setCurrentPage],
  );

  const handleRemovePage = useCallback(
    (idx: number) => {
      if (exportSnapshotRef.current) return;
      const targetPage = pagesRef.current[idx];
      if (targetPage?.id) {
        pageBlobStore.delete(targetPage.id);
      }
      setPages((prev) => {
        const newPages = prev.filter((_, i) => i !== idx);
        if (newPages.length === 0) setCurrentPage(0);
        else if (currentPageRef.current >= newPages.length)
          setCurrentPage(newPages.length - 1);
        return newPages;
      });
      void import("react-hot-toast").then((m) =>
        m.default("ลบรูปพังออกแล้ว", { duration: 1500 }),
      );
    },
    [exportSnapshotRef, setCurrentPage],
  );

  const handleReorderPages = useCallback(
    (reordered: WorkspaceExportPage[]) => {
      if (!exportSnapshotRef.current) setPages(reordered);
    },
    [exportSnapshotRef],
  );

  const handleClearAllPages = useCallback(() => {
    if (exportSnapshotRef.current) return;
    workspaceResourceManager.clear();
    setPages([]);
    setCurrentPage(0);
    sessionBridgeRef.current?.clearSavedSession?.();
  }, [exportSnapshotRef, setCurrentPage, sessionBridgeRef]);

  const handleImageError = useCallback((url: string) => {
    setBrokenPages((prev) => new Set(prev).add(url));
  }, []);

  const handlePageExportSourceChange = useCallback(
    (pageIndex: number, source: PageExportSource) => {
      setPages((current) =>
        current.map((page, index) =>
          index === pageIndex ? { ...page, exportSource: source } : page,
        ),
      );
    },
    [],
  );

  const handleRestoreSavedSession = useCallback(async () => {
    const restoreFn = sessionBridgeRef.current?.restoreSavedSession;
    if (!restoreFn) return;
    const restored = await restoreFn();
    if (restored && restored.pages.length > 0) {
      setPages(restored.pages);
      setCurrentPage(restored.currentPage || 0);
      setSavedSessionData(null);
      const hasTranslations = Boolean(
        (restored.bubbleCache && restored.bubbleCache.size > 0) ||
          (restored.translatedImageCache &&
            restored.translatedImageCache.size > 0),
      );
      if (hasTranslations) {
        sessionBridgeRef.current?.setWorkspaceLayer?.("translated");
      }
      const pendingLegacy =
        sessionBridgeRef.current?.inspectLegacyTargets?.();
      if (pendingLegacy && pendingLegacy.length > 0) {
        sessionBridgeRef.current?.setLegacyTargetPages?.(pendingLegacy);
      }
    }
    const toast = (await import("react-hot-toast")).default;
    if (savedSessionData?.hasUnrecoverableSources) {
      toast(
        "ดึงข้อมูลคำแปลกลับมาแล้ว กรุณานำเข้ารูปภาพต้นฉบับใหม่",
        { duration: 4000, icon: "⚠️" },
      );
    } else {
      toast("ดึงค่างานเดิมกลับมาเรียบร้อย!", { duration: 2000 });
    }
  }, [sessionBridgeRef, setCurrentPage, savedSessionData]);

  const handleClearSavedSession = useCallback(() => {
    sessionBridgeRef.current?.clearSavedSession?.();
    setSavedSessionData(null);
    void import("react-hot-toast").then((m) =>
      m.default("ล้างเซสชันเก่าแล้ว", { duration: 1500 }),
    );
  }, [sessionBridgeRef]);

  const handleExportProjectFile = useCallback(async () => {
    const toast = (await import("react-hot-toast")).default;
    try {
      const { exportPortableProjectBundle } = await import(
        "@/lib/projectStore"
      );
      const bundle = await exportPortableProjectBundle();
      if (!bundle) {
        toast.error("ยังไม่มีข้อมูลโปรเจกต์ให้บันทึก");
        return;
      }
      const blob = new Blob([JSON.stringify(bundle)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deriveProjectExportName(pagesRef.current, "SuperK_Project")}.superk.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("💾 บันทึกไฟล์โปรเจกต์ (.superk.json) เรียบร้อยแล้ว!");
    } catch {
      toast.error("บันทึกไฟล์โปรเจกต์ไม่สำเร็จ");
    }
  }, []);

  const handleImportProjectFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.superk,.superk.json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const toast = (await import("react-hot-toast")).default;
      try {
        const { importPortableProjectBundle } = await import(
          "@/lib/projectStore"
        );
        const raw = await file.text();
        await importPortableProjectBundle(raw);
        const restoreFn = sessionBridgeRef.current?.restoreSavedSession;
        const restored = restoreFn ? await restoreFn() : null;
        if (restored && restored.pages.length > 0) {
          setPages(restored.pages);
          setCurrentPage(restored.currentPage);
          setSavedSessionData(null);
          toast.success(`📂 เปิดโปรเจกต์สำเร็จ (${restored.pages.length} หน้า)!`);
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "ไม่สามารถเปิดไฟล์โปรเจกต์นี้ได้",
        );
      }
    };
    input.click();
  }, [sessionBridgeRef, setCurrentPage]);

  return {
    pages,
    setPages,
    currentPage,
    setCurrentPage,
    currentPageRef,
    pagesRef,
    confirmedPages,
    setConfirmedPages,
    confirmedPagesRef,
    confirmedMissingTranslationsRef,
    brokenPages,
    setBrokenPages,
    pageUrls,
    pageIds,
    pageNames,
    isDragging,
    isImporting,
    importStatusMessage,
    savedSessionData,
    setSavedSessionData,
    handleImageUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDeletePage,
    handleRemovePage,
    handleReorderPages,
    handleClearAllPages,
    handleImageError,
    handlePageExportSourceChange,
    handleRestoreSavedSession,
    handleClearSavedSession,
    handleExportProjectFile,
    handleImportProjectFile,
  };
}
