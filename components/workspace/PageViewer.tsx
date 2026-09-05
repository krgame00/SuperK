"use client";

import { useRef, useEffect, useState, useMemo, type ReactElement } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MaskLegend } from "@/components/cleaning/MaskLegend";
import { PageZoomToolbar } from "@/components/workspace/PageZoomToolbar";
import { usePageZoom } from "@/hooks/usePageZoom";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";
import { dataUrlToBlob } from "@/lib/projectStore";

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
}

function VirtualPageItem({
  page,
  index,
  totalPages,
  isTranslated,
  cleanedSrc,
  cachedTranslated,
  workspaceLayer,
  scrollZoomMode,
  onPageChange,
  onViewLayoutChange,
}: {
  page: { url: string; name: string };
  index: number;
  totalPages: number;
  isTranslated: boolean;
  cleanedSrc: string;
  cachedTranslated: string | undefined;
  workspaceLayer: string;
  scrollZoomMode: "fit-width" | "actual-size";
  onPageChange: (idx: number) => void;
  onViewLayoutChange: (layout: "single" | "scroll") => void;
}) {
  const blobUrl = useMemo(() => {
    if (cachedTranslated?.startsWith("data:")) {
      return URL.createObjectURL(dataUrlToBlob(cachedTranslated));
    }
    return null;
  }, [cachedTranslated]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const imgSrc =
    workspaceLayer === "original"
      ? page.url
      : workspaceLayer === "translated" && isTranslated
        ? blobUrl ?? cachedTranslated ?? cleanedSrc
        : cleanedSrc;

  return (
    <div
      className={`relative cursor-pointer hover:opacity-95 transition-opacity ${
        scrollZoomMode === "actual-size" ? "w-auto max-w-none flex justify-center" : "w-full"
      }`}
      onClick={() => {
        onPageChange(index);
        onViewLayoutChange("single");
      }}
      title="คลิกเพื่อแก้ไขหน้านี้ในโหมดทีละหน้า"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgSrc}
        alt={`Page ${index + 1}`}
        draggable={false}
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
}: PageViewerProps): ReactElement | null {
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

  // Preload natural dimensions for all pages in background so switching pages never flashes unmeasured scale
  useEffect(() => {
    if (typeof window === "undefined" || !pages.length) return;
    pages.forEach((page) => {
      if (naturalDimensionsMap[page.url]) return;
      const preloader = new Image();
      preloader.src = page.url;
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
    });
  }, [pages, naturalDimensionsMap]);

  const zoom = usePageZoom({
    currentPage,
    workspaceLayer,
    viewLayout,
    containerRef: viewportRef,
    imageNaturalWidth: naturalDimensions?.width,
    imageNaturalHeight: naturalDimensions?.height,
  });

  const isTransitionActive = Boolean(naturalDimensions && hasSettled && !zoom.isPanning);

  // Remeasure virtualizer items when scrollZoomMode changes
  useEffect(() => {
    if (viewLayout === "scroll") {
      virtualizer.measure();
    }
  }, [zoom.scrollZoomMode, viewLayout, virtualizer]);

  // Auto-scroll to current page when switching from single to scroll mode
  useEffect(() => {
    if (prevViewLayoutRef.current !== "scroll" && viewLayout === "scroll" && currentPage > 0) {
      virtualizer.scrollToIndex(currentPage, { align: "start" });
    }
    prevViewLayoutRef.current = viewLayout;
  }, [viewLayout, currentPage, virtualizer]);

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
                    isTranslated={translatedImagesMap?.has(p.url) ?? false}
                    cleanedSrc={cleaningResultsByPage.get(p.url)?.cleanUrl ?? p.url}
                    cachedTranslated={translatedImagesMap?.get(p.url)}
                    workspaceLayer={workspaceLayer}
                    scrollZoomMode={zoom.scrollZoomMode}
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
              className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full border border-border/80 bg-background/80 text-foreground/90 shadow-xl backdrop-blur-md transition-all duration-150 hover:bg-surface hover:text-white hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background z-30"
              title="Previous Page (Left Arrow)"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
          )}

          {/* Inner container that hugs the image tightly with zoom and pan transform */}
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
                      : currentCleaningResult?.cleanUrl ?? currentPageItem.url
                  }
                  alt={`หน้า ${currentPage + 1}: ${currentPageItem.name}`}
                  title={currentPageItem.name}
                  draggable={false}
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

          {/* Right Arrow Floating Button */}
          {currentPage < pages.length - 1 && (
            <button
              type="button"
              onClick={() => onPageChange((prev) => prev + 1)}
              aria-label={`หน้าถัดไป (หน้า ${currentPage + 2} จาก ${pages.length})`}
              className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full border border-border/80 bg-background/80 text-foreground/90 shadow-xl backdrop-blur-md transition-all duration-150 hover:bg-surface hover:text-white hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background z-30"
              title="Next Page (Right Arrow)"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
          )}

          {/* Floating Page Badge */}
          <div className="absolute bottom-2 bg-background/90 backdrop-blur-xs text-foreground text-xs font-medium px-3.5 py-1.5 rounded-full border border-border shadow-md pointer-events-none z-30" aria-live="polite">
            <span className="sr-only">หน้าปัจจุบัน: </span>{currentPage + 1} / {pages.length}
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
          />
        </div>
      )}
    </div>
  );
}
