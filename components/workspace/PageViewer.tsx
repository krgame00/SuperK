"use client";

import { useRef, useEffect, useState, useMemo, type ReactElement } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MaskLegend } from "@/components/cleaning/MaskLegend";
import { PageZoomToolbar } from "@/components/workspace/PageZoomToolbar";
import { usePageZoom } from "@/hooks/usePageZoom";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";
import { CompareSlider } from "@/components/workspace/CompareSlider";
import { ViewportCanvasEngine, WEBTOON_LONG_STRIP_THRESHOLD } from "@/lib/canvas/ViewportCanvasEngine";
import { applyTranslationOverlay, type TranslatedBubble, type OverlayTextStyle } from "@/lib/translationOverlay";
import type { PixelRect } from "@/lib/cleaning/types";

export interface PageViewerProps {
  pages: { url: string; name: string }[];
  currentPage: number;
  viewLayout: "single" | "scroll";
  workspaceLayer: WorkspaceLayer;
  currentCleaningResult: PageCleaningResult | null | undefined;
  cleaningResultsByPage: Map<string, PageCleaningResult>;
  translatedImagesMap?: Map<string, string>;
  brokenPages: Set<string>;
  onPageChange: (index: number | ((prev: number) => number)) => void;
  onViewLayoutChange: (layout: "single" | "scroll") => void;
  onRemovePage: (index: number) => void;
  onImageError: (url: string) => void;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  isFilmstripVisible?: boolean;
  hasInspectorOpen?: boolean;
  isSplitView?: boolean;
  comparisonMode?: "side-by-side" | "slider";
  onComparisonModeChange?: (mode: "side-by-side" | "slider") => void;
  getBubblesForPage?: (pageUrl: string) => TranslatedBubble[];
  textStyleRef?: React.MutableRefObject<OverlayTextStyle>;
  targetLang?: string;
}

function VirtualPageItem({
  page,
  index,
  totalPages,
  bubbles = [],
  cleanedSrc,
  cachedTranslated,
  workspaceLayer,
  scrollZoomMode,
  textStyleRef,
  targetLang = "th",
  onPageChange,
  onViewLayoutChange,
}: {
  page: { url: string; name: string };
  index: number;
  totalPages: number;
  bubbles?: TranslatedBubble[];
  cleanedSrc: string;
  cachedTranslated: string | undefined;
  workspaceLayer: string;
  scrollZoomMode: "fit-width" | "actual-size";
  textStyleRef?: React.MutableRefObject<OverlayTextStyle>;
  targetLang?: string;
  onPageChange: (idx: number) => void;
  onViewLayoutChange: (layout: "single" | "scroll") => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasCachedImage = Boolean(cachedTranslated);
  const hasBubbles = Boolean(
    bubbles &&
      bubbles.some(
        (b) =>
          !b.deleted &&
          !b.hidden &&
          Boolean((b.t ?? b.translated ?? "").trim() || b.layoutAdjustment),
      ),
  );

  const imgSrc =
    workspaceLayer === "original"
      ? page.url
      : workspaceLayer === "translated" && hasCachedImage
        ? cachedTranslated
        : cleanedSrc;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let isCancelled = false;

    const cleanupOverlays = () => {
      container.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => {
        const cleanup = (el as unknown as { _cleanupListeners?: () => void })._cleanupListeners;
        if (typeof cleanup === "function") cleanup();
        el.remove();
      });
    };

    if (workspaceLayer === "translated" && !hasCachedImage && hasBubbles && bubbles) {
      void applyTranslationOverlay(
        bubbles,
        "scroll",
        index,
        () => {},
        undefined,
        textStyleRef,
        container,
        page.url,
        undefined,
        targetLang,
      ).then(() => {
        if (isCancelled) {
          cleanupOverlays();
        }
      });
    } else {
      cleanupOverlays();
    }

    return () => {
      isCancelled = true;
      cleanupOverlays();
    };
  }, [workspaceLayer, hasCachedImage, hasBubbles, bubbles, index, page.url, textStyleRef, targetLang]);

  return (
    <div
      ref={containerRef}
      id={`spage-${index}`}
      role="button"
      tabIndex={0}
      aria-label={`หน้า ${index + 1} จาก ${totalPages}: คลิกเพื่อแก้ไขหน้านี้ในโหมดทีละหน้า`}
      className={`relative cursor-pointer hover:opacity-95 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md ${
        scrollZoomMode === "actual-size" ? "w-auto max-w-none flex justify-center" : "w-full"
      }`}
      onClick={() => {
        onPageChange(index);
        onViewLayoutChange("single");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPageChange(index);
          onViewLayoutChange("single");
        }
      }}
      title="คลิกเพื่อแก้ไขหน้านี้ในโหมดทีละหน้า"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgSrc}
        alt={`Page ${index + 1}`}
        draggable={false}
        decoding="async"
        onDragStart={(e) => e.preventDefault()}
        className={`${
          scrollZoomMode === "actual-size"
            ? "w-auto max-w-none h-auto block m-0 p-0 shadow-md select-none"
            : "w-full h-auto object-contain block m-0 p-0 select-none"
        }`}
      />
      <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2.5 py-1 rounded-md opacity-0 hover:opacity-100 pointer-events-none transition-opacity">
        {index + 1} / {totalPages}
      </div>
    </div>
  );
}

export function PageViewer({
  pages,
  currentPage,
  viewLayout,
  workspaceLayer,
  currentCleaningResult,
  cleaningResultsByPage,
  translatedImagesMap,
  brokenPages,
  onPageChange,
  onViewLayoutChange,
  onRemovePage,
  onImageError,
  isFocusMode = false,
  onToggleFocusMode,
  isFilmstripVisible = false,
  hasInspectorOpen = false,
  isSplitView = false,
  comparisonMode: comparisonModeProp,
  onComparisonModeChange,
  getBubblesForPage,
  textStyleRef,
  targetLang = "th",
}: PageViewerProps): ReactElement | null {
  const [localComparisonMode, setLocalComparisonMode] = useState<"side-by-side" | "slider">("side-by-side");
  const activeComparisonMode = comparisonModeProp ?? localComparisonMode;

  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const prevViewLayoutRef = useRef(viewLayout);
  const [naturalDimensionsMap, setNaturalDimensionsMap] = useState<Record<string, { width: number; height: number }>>({});

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => listRef.current,
    enabled: viewLayout === "scroll",
    estimateSize: () => 1000,
    overscan: 2,
    paddingStart: 24,
    paddingEnd: 80,
    initialRect: { width: 800, height: 1000 },
    observeElementRect: (instance, cb) => {
      const element = instance.scrollElement;
      if (!element) return;
      const handler = () => {
        const rect = element.getBoundingClientRect();
        const width = Math.round(rect.width) || element.offsetWidth || 800;
        const height = Math.round(rect.height) || element.offsetHeight || 1000;
        cb({ width, height });
      };
      handler();
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(handler);
        observer.observe(element);
        return () => observer.disconnect();
      }
    },
  });

  const currentPageItem = pages[currentPage];
  const naturalDimensions = currentPageItem ? naturalDimensionsMap[currentPageItem.url] ?? null : null;

  const [hasSettled, setHasSettled] = useState(false);

  // Suppress transform transitions on initial load, page change, or while natural dimensions are settling
  useEffect(() => {
    setHasSettled(false);
    const timer = setTimeout(() => {
      setHasSettled(true);
    }, 120);
    return () => clearTimeout(timer);
  }, [currentPage, naturalDimensions?.width, naturalDimensions?.height]);

  // Preload natural dimensions in a sliding window around currentPage (currentPage ± 2)
  // so navigating adjacent pages is instantaneous without forcing browser to decode dozens of images at once.
  useEffect(() => {
    if (typeof window === "undefined" || !pages.length) return;

    const windowStart = Math.max(0, currentPage - 2);
    const windowEnd = Math.min(pages.length - 1, currentPage + 2);
    const windowPages = pages.slice(windowStart, windowEnd + 1);

    const activePreloaders: HTMLImageElement[] = [];

    windowPages.forEach((page) => {
      if (naturalDimensionsMap[page.url]) return;
      const preloader = new Image();
      preloader.decoding = "async";
      const onPreload = () => {
        if (preloader.naturalWidth && preloader.naturalHeight) {
          setNaturalDimensionsMap((prev) => {
            if (prev[page.url]) return prev;
            return {
              ...prev,
              [page.url]: {
                width: preloader.naturalWidth,
                height: preloader.naturalHeight,
              },
            };
          });
        }
      };
      if (preloader.complete) {
        onPreload();
      } else {
        preloader.onload = onPreload;
      }
      preloader.src = page.url;
      activePreloaders.push(preloader);
    });

    return () => {
      activePreloaders.forEach((img) => {
        img.onload = null;
      });
    };
  }, [pages, currentPage, naturalDimensionsMap]);

  const zoom = usePageZoom({
    currentPage,
    workspaceLayer,
    viewLayout,
    containerRef: viewportRef,
    imageNaturalWidth: naturalDimensions?.width,
    imageNaturalHeight: naturalDimensions?.height,
    isSplitView: isSplitView && activeComparisonMode === "side-by-side",
  });

  const viewportEngine = useMemo(() => {
    if (naturalDimensions && naturalDimensions.height >= WEBTOON_LONG_STRIP_THRESHOLD) {
      return new ViewportCanvasEngine(naturalDimensions.width, naturalDimensions.height);
    }
    return null;
  }, [naturalDimensions]);

  const isTransitionActive = Boolean(
    naturalDimensions &&
    hasSettled &&
    !zoom.isPanning &&
    !zoom.isInertiaActive &&
    !zoom.isWheelActive
  );

  // Remeasure virtualizer items when scrollZoomMode changes
  useEffect(() => {
    if (viewLayout === "scroll") {
      virtualizer.measure();
    }
  }, [zoom.scrollZoomMode, viewLayout, virtualizer]);

  // Notify translation overlay engine to re-attach whenever split view, comparison mode, or page changes
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent("superk:request-overlay-refresh"));
    }, 40);
    return () => clearTimeout(timer);
  }, [isSplitView, activeComparisonMode, currentPage]);

  // Auto-scroll to current page when switching from single to scroll mode
  useEffect(() => {
    if (prevViewLayoutRef.current !== "scroll" && viewLayout === "scroll" && currentPage > 0) {
      virtualizer.scrollToIndex(currentPage, { align: "start" });
    }
    prevViewLayoutRef.current = viewLayout;
  }, [viewLayout, currentPage, virtualizer]);

  const [highlightedRegion, setHighlightedRegion] = useState<{
    id: string;
    rect: PixelRect;
  } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleFocusCandidate = (e: Event) => {
      const custom = e as CustomEvent<{ id: string; rect: PixelRect }>;
      if (!custom.detail?.rect) return;
      const { id, rect } = custom.detail;
      setHighlightedRegion({ id, rect });

      if (viewLayout === "scroll") {
        const el = document.getElementById(`spage-${currentPage}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        zoom.zoomTo(Math.max(zoom.scale, 1.1), { x: cx, y: cy });
      }

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setHighlightedRegion(null);
      }, 4000);
    };

    window.addEventListener("superk:focus-candidate-region", handleFocusCandidate);
    return () => {
      window.removeEventListener("superk:focus-candidate-region", handleFocusCandidate);
      if (timer) clearTimeout(timer);
    };
  }, [viewLayout, currentPage, zoom]);

  const [remnantPanelState, setRemnantPanelState] = useState<{ open: boolean; side: "left" | "right" }>({
    open: false,
    side: "right",
  });

  useEffect(() => {
    const handleRemnantState = (e: Event) => {
      const custom = e as CustomEvent<{ open: boolean; side: "left" | "right" }>;
      if (custom.detail) {
        setRemnantPanelState(custom.detail);
      }
    };
    window.addEventListener("superk:remnant-state", handleRemnantState);
    return () => {
      window.removeEventListener("superk:remnant-state", handleRemnantState);
    };
  }, []);

  if (pages.length === 0) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoom.scale > zoom.fitScale + 0.05) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (zoom.scale > zoom.fitScale + 0.05) return;
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const diffX = touchStartXRef.current - e.changedTouches[0].clientX;
    const diffY = touchStartYRef.current - e.changedTouches[0].clientY;

    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
      if (diffX > 0 && currentPage < pages.length - 1) {
        onPageChange((prev) => prev + 1);
      } else if (diffX < 0 && currentPage > 0) {
        onPageChange((prev) => prev - 1);
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  return (
    <div
      className={`relative w-full flex-1 h-full min-h-0 overflow-hidden ${
        viewLayout === "scroll" ? "flex flex-col items-stretch justify-start" : "flex justify-center items-center"
      }`}
    >
      {viewLayout === "scroll" ? (
        <div
          ref={listRef}
          role="region"
          aria-label="พื้นที่เลื่อนอ่านมังงะ"
          tabIndex={0}
          className="relative w-full h-full min-h-0 overflow-auto scroll-smooth focus:outline-none"
        >
          <div
            className={`relative mx-auto transition-all duration-200 ${
              zoom.scrollZoomMode === "actual-size"
                ? "w-full max-w-none px-4 flex flex-col items-center"
                : "w-full max-w-3xl sm:max-w-4xl lg:max-w-5xl"
            }`}
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const idx = virtualItem.index;
              const p = pages[idx];
              const pageBubbles = getBubblesForPage?.(p.url) ?? [];
              const cachedTranslated = translatedImagesMap?.get(p.url);
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full flex justify-center"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <VirtualPageItem
                    page={p}
                    index={idx}
                    totalPages={pages.length}
                    bubbles={pageBubbles}
                    cleanedSrc={cleaningResultsByPage.get(p.url)?.cleanUrl ?? p.url}
                    cachedTranslated={cachedTranslated}
                    workspaceLayer={workspaceLayer}
                    scrollZoomMode={zoom.scrollZoomMode}
                    textStyleRef={textStyleRef}
                    targetLang={targetLang}
                    onPageChange={onPageChange}
                    onViewLayoutChange={onViewLayoutChange}
                  />
                </div>
              );
            })}
          </div>

          {/* Floating Zoom Toolbar in Scroll Mode */}
          <PageZoomToolbar
            viewLayout={viewLayout}
            scale={zoom.scale}
            displayPercentage={zoom.displayPercentage}
            isFit={zoom.isFit}
            scrollZoomMode={zoom.scrollZoomMode}
            onZoomIn={zoom.zoomIn}
            onZoomOut={zoom.zoomOut}
            onZoomTo={zoom.zoomTo}
            onResetToFit={zoom.resetToFit}
            onToggleScrollZoomMode={zoom.toggleScrollZoomMode}
            isFocusMode={isFocusMode}
            onToggleFocusMode={onToggleFocusMode}
            avoidBottomChrome={isFilmstripVisible}
          />
        </div>
      ) : (
        <div
          ref={viewportRef}
          onWheel={zoom.handleWheel}
          onPointerDown={zoom.handlePointerDown}
          onPointerMove={zoom.handlePointerMove}
          onPointerUp={zoom.handlePointerUp}
          onPointerCancel={zoom.handlePointerCancel}
          onDoubleClick={zoom.handleDoubleClick}
          onDragStart={(e) => e.preventDefault()}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={`relative w-full h-full flex justify-center items-center overflow-hidden select-none ${
            zoom.isPanning
              ? "cursor-grabbing"
              : zoom.isSpacePressed
                ? "cursor-grab"
                : zoom.scale > zoom.fitScale + 0.05
                  ? "cursor-grab"
                  : "cursor-default"
          } ${
            workspaceLayer === "translated" ? "" : "hide-translation"
          }`}
        >
          {/* Left Arrow Floating Button */}
          {currentPage > 0 && (
            <button
              type="button"
              onClick={() => onPageChange((prev) => prev - 1)}
              aria-label={`หน้าที่แล้ว (หน้า ${currentPage} จาก ${pages.length})`}
              className={`absolute top-1/2 -translate-y-1/2 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full border border-border/80 bg-background/80 text-foreground/90 shadow-xl backdrop-blur-md transition-all duration-150 hover:bg-surface hover:text-white hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background z-50 ${
                remnantPanelState.open && remnantPanelState.side === "left"
                  ? "left-3 2xl:left-[28rem]"
                  : isFocusMode
                    ? "left-3 sm:left-6"
                    : "left-3 sm:left-6 lg:left-20"
              }`}
              title="Previous Page (Left Arrow)"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
          )}

          {/* Inner container that hugs the image tightly with zoom and pan transform */}
          {isSplitView ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden z-10">
              {/* Comparison Mode Switcher Header */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-black/80 px-2 py-1 rounded-full border border-border/60 shadow-lg backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => {
                    setLocalComparisonMode("side-by-side");
                    onComparisonModeChange?.("side-by-side");
                  }}
                  data-testid="compare-mode-side-by-side-btn"
                  className={`px-2.5 py-0.5 text-xs font-medium rounded-full transition-all cursor-pointer ${
                    activeComparisonMode === "side-by-side"
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted hover:text-white"
                  }`}
                  title="แสดงภาพต้นฉบับและภาพแปลคู่กันสองฝั่ง"
                >
                  เทียบสองฝั่ง
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocalComparisonMode("slider");
                    onComparisonModeChange?.("slider");
                  }}
                  data-testid="compare-mode-slider-btn"
                  className={`px-2.5 py-0.5 text-xs font-medium rounded-full transition-all cursor-pointer ${
                    activeComparisonMode === "slider"
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted hover:text-white"
                  }`}
                  title="แสดงตัวเลื่อนสไลด์เปรียบเทียบม่านก่อน-หลัง"
                >
                  ตัวเลื่อนม่าน (Slider)
                </button>
              </div>

              {activeComparisonMode === "slider" && currentPageItem ? (
                <CompareSlider
                  originalUrl={currentPageItem.url}
                  translatedUrl={
                    workspaceLayer === "original"
                      ? currentPageItem.url
                      : translatedImagesMap?.get(currentPageItem.url) ??
                        currentCleaningResult?.cleanUrl ??
                        cleaningResultsByPage.get(currentPageItem.url)?.cleanUrl ??
                        currentPageItem.url
                  }
                  originalAlt={`ต้นฉบับ: ${currentPageItem.name}`}
                  translatedAlt={
                    workspaceLayer === "clean"
                      ? `ภาพคลีนแล้ว: ${currentPageItem.name}`
                      : `หน้าแปลแล้ว: ${currentPageItem.name}`
                  }
                  naturalDimensions={naturalDimensions}
                  stageStyle={zoom.stageStyle}
                  zoomScale={zoom.scale}
                />
              ) : (
                <div className="relative w-full h-full flex flex-row items-center justify-center gap-3 p-2 overflow-hidden">
                  {/* Left Column: Original Raw Artwork */}
                  <div
                    data-testid="split-view-original-pane"
                    className="relative flex-1 h-full flex items-center justify-center border-r border-border/60 overflow-hidden bg-background/40 rounded-xl"
                  >
                    <div className="absolute top-2 left-2 z-30 bg-black/75 text-neutral-200 border border-neutral-700/60 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide shadow-md pointer-events-none">
                      ต้นฉบับ (Original)
                    </div>
                    {currentPageItem && (
                      <div
                        className="absolute top-0 left-0 inline-flex shrink-0 justify-center items-center select-none"
                        style={{
                          width: naturalDimensions ? `${naturalDimensions.width}px` : "100%",
                          height: naturalDimensions ? `${naturalDimensions.height}px` : "100%",
                          opacity: naturalDimensions ? 1 : 0,
                          ...zoom.stageStyle,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={currentPageItem.url}
                          alt={`ต้นฉบับ: ${currentPageItem.name}`}
                          draggable={false}
                          decoding="async"
                          className="max-w-none max-h-none object-contain drop-shadow-sm select-none block pointer-events-none"
                          style={{
                            width: "100%",
                            height: "100%",
                            userSelect: "none",
                            WebkitUserDrag: "none",
                          } as React.CSSProperties}
                        />
                      </div>
                    )}
                  </div>

                  {/* Right Column: Translated & Cleaned Artwork */}
                  <div
                    data-testid="split-view-translated-pane"
                    className={`relative flex-1 h-full flex items-center justify-center overflow-hidden bg-background/40 rounded-xl ${
                      workspaceLayer === "translated" ? "" : "hide-translation"
                    }`}
                  >
                    <div className="absolute top-2 left-2 z-30 bg-primary/85 text-white border border-primary/50 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide shadow-md pointer-events-none">
                      หน้าแปลแล้ว (Translated)
                    </div>
                    <div
                      key={currentPage}
                      id="pageContainer"
                      onDragStart={(e) => e.preventDefault()}
                      className={`absolute top-0 left-0 inline-flex shrink-0 justify-center items-center select-none ${
                        isTransitionActive ? "transition-transform duration-150 ease-out" : ""
                      }`}
                      style={{
                        width: naturalDimensions ? `${naturalDimensions.width}px` : "100%",
                        height: naturalDimensions ? `${naturalDimensions.height}px` : "100%",
                        opacity: naturalDimensions ? 1 : 0,
                        transition: isTransitionActive ? undefined : "none",
                        ...zoom.stageStyle,
                      }}
                    >
                      {currentPageItem && brokenPages.has(currentPageItem.url) ? (
                        <div className="flex flex-col items-center justify-center p-8 bg-surface/40 border border-red-500/30 rounded-xl text-center gap-3 my-8">
                          <div className="text-red-400 font-medium text-base">
                            ⚠️ รูปภาพนี้เสีย หรือโหลดไม่สมบูรณ์ ({currentPageItem.name})
                          </div>
                          <p className="text-muted text-xs max-w-sm">
                            รูปนี้อาจมาจากไฟล์ทอร์เรนต์ที่โหลดไม่ครบ 100% ทำให้ไม่สามารถแสดงผลได้
                          </p>
                          <button
                            type="button"
                            onClick={() => onRemovePage(currentPage)}
                            aria-label={`ลบรูปภาพที่เสียออก: ${currentPageItem.name}`}
                            className="bg-red-500/20 text-red-400 hover:bg-red-500/30 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                          >
                            🗑️ ลบรูปพังนี้ออก
                          </button>
                        </div>
                      ) : currentPageItem ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={
                              workspaceLayer === "original"
                                ? currentPageItem.url
                                : currentCleaningResult?.cleanUrl ??
                                  cleaningResultsByPage.get(currentPageItem.url)?.cleanUrl ??
                                  translatedImagesMap?.get(currentPageItem.url) ??
                                  currentPageItem.url
                            }
                            alt={`หน้าแปลแล้ว: ${currentPageItem.name}`}
                            title={currentPageItem.name}
                            draggable={false}
                            decoding="async"
                            onDragStart={(e) => e.preventDefault()}
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              if (img.naturalWidth && img.naturalHeight && currentPageItem) {
                                setNaturalDimensionsMap((prev) => ({
                                  ...prev,
                                  [currentPageItem.url]: {
                                    width: img.naturalWidth,
                                    height: img.naturalHeight,
                                  },
                                }));
                              }
                            }}
                            onError={() => onImageError(currentPageItem.url)}
                            className="max-w-none max-h-none object-contain drop-shadow-sm select-none block pointer-events-none"
                            style={{
                              width: "100%",
                              height: "100%",
                              userSelect: "none",
                              WebkitUserDrag: "none",
                            } as React.CSSProperties}
                          />
                        </>
                      ) : null}
                      {workspaceLayer === "mask" && currentCleaningResult && (
                        <>
                          {[
                            {
                              url: currentCleaningResult.maskUrl,
                              color: "rgba(255, 55, 80, .58)",
                              label: "Eligible cleaning mask",
                            },
                            {
                              url: currentCleaningResult.reviewMaskUrl,
                              color: "rgba(255, 190, 40, .58)",
                              label: "Review mask",
                            },
                            {
                              url: currentCleaningResult.protectedMaskUrl,
                              color: "rgba(45, 145, 255, .58)",
                              label: "Protected mask",
                            },
                          ].map((maskLayer) => (
                            <span
                              key={maskLayer.label}
                              role="img"
                              aria-label={maskLayer.label}
                              className="pointer-events-none absolute inset-0 mix-blend-screen"
                              style={{
                                backgroundColor: maskLayer.color,
                                maskImage: `url(${maskLayer.url})`,
                                WebkitMaskImage: `url(${maskLayer.url})`,
                                maskPosition: "center",
                                WebkitMaskPosition: "center",
                                maskRepeat: "no-repeat",
                                WebkitMaskRepeat: "no-repeat",
                                maskSize: "100% 100%",
                                WebkitMaskSize: "100% 100%",
                              }}
                            />
                          ))}
                          <MaskLegend regions={currentCleaningResult.regions} />
                        </>
                      )}
                    </div>
                    {/* Dedicated Chrome Overlay Layer inside split translated pane */}
                    <div
                      data-overlay-chrome-layer="true"
                      className="pointer-events-none absolute inset-0 z-40 overflow-visible"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              key={currentPage}
              id="pageContainer"
              data-webtoon-engine={viewportEngine ? "active" : undefined}
              data-viewport-tiles={viewportEngine?.totalTiles}
              onDragStart={(e) => e.preventDefault()}
              className={`absolute top-0 left-0 inline-flex shrink-0 justify-center items-center select-none ${
                isTransitionActive ? "transition-transform duration-150 ease-out" : ""
              }`}
              style={{
                width: naturalDimensions ? `${naturalDimensions.width}px` : "100%",
                height: naturalDimensions ? `${naturalDimensions.height}px` : "100%",
                opacity: naturalDimensions ? 1 : 0,
                transition: isTransitionActive ? undefined : "none",
                ...zoom.stageStyle,
              }}
            >
              {currentPageItem && brokenPages.has(currentPageItem.url) ? (
                <div className="flex flex-col items-center justify-center p-8 bg-surface/40 border border-red-500/30 rounded-xl text-center gap-3 my-8">
                  <div className="text-red-400 font-medium text-base">
                    ⚠️ รูปภาพนี้เสีย หรือโหลดไม่สมบูรณ์ ({currentPageItem.name})
                  </div>
                  <p className="text-muted text-xs max-w-sm">
                    รูปนี้อาจมาจากไฟล์ทอร์เรนต์ที่โหลดไม่ครบ 100% ทำให้ไม่สามารถแสดงผลได้
                  </p>
                  <button
                    type="button"
                    onClick={() => onRemovePage(currentPage)}
                    aria-label={`ลบรูปภาพที่เสียออก: ${currentPageItem.name}`}
                    className="bg-red-500/20 text-red-400 hover:bg-red-500/30 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  >
                    🗑️ ลบรูปพังนี้ออก
                  </button>
                </div>
              ) : currentPageItem ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      workspaceLayer === "original"
                        ? currentPageItem.url
                        : currentCleaningResult?.cleanUrl ??
                          cleaningResultsByPage.get(currentPageItem.url)?.cleanUrl ??
                          currentPageItem.url
                    }
                    alt={`หน้า ${currentPage + 1}: ${currentPageItem.name}`}
                    title={currentPageItem.name}
                    draggable={false}
                    decoding="async"
                    onDragStart={(e) => e.preventDefault()}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight && currentPageItem) {
                        setNaturalDimensionsMap((prev) => ({
                          ...prev,
                          [currentPageItem.url]: {
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                          },
                        }));
                      }
                    }}
                    onError={() => onImageError(currentPageItem.url)}
                    className="max-w-none max-h-none object-contain drop-shadow-sm select-none block pointer-events-none"
                    style={{
                      width: "100%",
                      height: "100%",
                      userSelect: "none",
                      WebkitUserDrag: "none",
                    } as React.CSSProperties}
                  />
                </>
              ) : null}
              {workspaceLayer === "mask" && currentCleaningResult && (
                <>
                  {[
                    {
                      url: currentCleaningResult.maskUrl,
                      color: "rgba(255, 55, 80, .58)",
                      label: "Eligible cleaning mask",
                    },
                    {
                      url: currentCleaningResult.reviewMaskUrl,
                      color: "rgba(255, 190, 40, .58)",
                      label: "Review mask",
                    },
                    {
                      url: currentCleaningResult.protectedMaskUrl,
                      color: "rgba(45, 145, 255, .58)",
                      label: "Protected mask",
                    },
                  ].map((maskLayer) => (
                    <span
                      key={maskLayer.label}
                      role="img"
                      aria-label={maskLayer.label}
                      className="pointer-events-none absolute inset-0 mix-blend-screen"
                      style={{
                        backgroundColor: maskLayer.color,
                        maskImage: `url(${maskLayer.url})`,
                        WebkitMaskImage: `url(${maskLayer.url})`,
                        maskPosition: "center",
                        WebkitMaskPosition: "center",
                        maskRepeat: "no-repeat",
                        WebkitMaskRepeat: "no-repeat",
                        maskSize: "100% 100%",
                        WebkitMaskSize: "100% 100%",
                      }}
                    />
                  ))}
                  <MaskLegend regions={currentCleaningResult.regions} />
                </>
              )}
              {highlightedRegion && (
                <div
                  data-testid="candidate-highlight-box"
                  className="absolute pointer-events-none rounded-lg border-2 border-amber-400 bg-amber-400/25 ring-4 ring-amber-400/40 animate-pulse z-50 transition-all duration-200"
                  style={{
                    left: `${highlightedRegion.rect.x}px`,
                    top: `${highlightedRegion.rect.y}px`,
                    width: `${highlightedRegion.rect.width}px`,
                    height: `${highlightedRegion.rect.height}px`,
                  }}
                >
                  <span className="absolute -top-6 left-0 px-1.5 py-0.5 rounded bg-amber-500 text-black font-bold text-[10px] shadow whitespace-nowrap">
                    จุดตรวจ #{highlightedRegion.id}
                  </span>
                </div>
              )}
            </div>
          )}

          <div
            id="overlayChromeLayer"
            data-overlay-chrome-layer="true"
            className="pointer-events-none absolute inset-0 z-40 overflow-visible"
          />

          {/* Right Arrow Floating Button */}
          {currentPage < pages.length - 1 && (
            <button
              type="button"
              onClick={() => onPageChange((prev) => prev + 1)}
              aria-label={`หน้าถัดไป (หน้า ${currentPage + 2} จาก ${pages.length})`}
              className={`absolute top-1/2 -translate-y-1/2 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full border border-border/80 bg-background/80 text-foreground/90 shadow-xl backdrop-blur-md transition-all duration-150 hover:bg-surface hover:text-white hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background z-50 ${
                hasInspectorOpen
                  ? "hidden 2xl:flex right-3 2xl:right-[22rem]"
                  : remnantPanelState.open && remnantPanelState.side === "right"
                    ? "flex right-3 2xl:right-[28rem]"
                    : "flex right-3 sm:right-6"
              }`}
              title="Next Page (Right Arrow)"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
          )}

          {/* Floating Page Badge — small, pinned top-left so it never covers the artwork */}
          <div
            className="absolute top-2 left-2 bg-black/60 text-white/90 text-[10px] font-medium px-2 py-0.5 rounded-md pointer-events-none z-30 tabular-nums"
            aria-live="polite"
          >
            <span className="sr-only">หน้าปัจจุบัน: </span>
            {currentPage + 1} / {pages.length}
          </div>

          {/* Floating Zoom Toolbar in Single Mode */}
          <PageZoomToolbar
            viewLayout={viewLayout}
            scale={zoom.scale}
            displayPercentage={zoom.displayPercentage}
            isFit={zoom.isFit}
            scrollZoomMode={zoom.scrollZoomMode}
            disabled={brokenPages.has(currentPageItem?.url ?? "")}
            onZoomIn={zoom.zoomIn}
            onZoomOut={zoom.zoomOut}
            onZoomTo={zoom.zoomTo}
            onResetToFit={zoom.resetToFit}
            onToggleScrollZoomMode={zoom.toggleScrollZoomMode}
            isFocusMode={isFocusMode}
            onToggleFocusMode={onToggleFocusMode}
            avoidBottomChrome={isFilmstripVisible}
          />
        </div>
      )}
    </div>
  );
}
