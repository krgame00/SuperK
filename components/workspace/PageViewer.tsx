"use client";

import { useRef, useEffect, useMemo, type ReactElement } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MaskLegend } from "@/components/cleaning/MaskLegend";
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
}

function VirtualPageItem({
  page,
  index,
  totalPages,
  isTranslated,
  cleanedSrc,
  cachedTranslated,
  workspaceLayer,
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
      className="w-full relative cursor-pointer hover:opacity-95 transition-opacity"
      onClick={() => {
        onPageChange(index);
        onViewLayoutChange("single");
      }}
      title="Click to edit this page"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgSrc}
        alt={`Page ${index + 1}`}
        className="w-full h-auto object-contain block m-0 p-0"
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
}: PageViewerProps): ReactElement | null {
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const virtualizer = useWindowVirtualizer({
    count: pages.length,
    estimateSize: () => 1000,
    overscan: 2,
  });

  if (pages.length === 0) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
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

  const currentPageItem = pages[currentPage];

  return (
    <div className="relative w-full flex justify-center items-center flex-1 min-h-[60vh]">
      {viewLayout === "scroll" ? (
        <div
          ref={listRef}
          className="relative w-full max-w-3xl sm:max-w-4xl lg:max-w-5xl mx-auto pb-32"
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
                  onPageChange={onPageChange}
                  onViewLayoutChange={onViewLayoutChange}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={`relative w-full max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl flex justify-center items-center ${
            workspaceLayer === "translated" ? "" : "hide-translation"
          }`}
        >
          {/* Left Arrow Floating Button */}
          {currentPage > 0 && (
            <button
              type="button"
              onClick={() => onPageChange((prev) => prev - 1)}
              aria-label={`หน้าที่แล้ว (หน้า ${currentPage} จาก ${pages.length})`}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-xl backdrop-blur-xs transition-all duration-150 hover:bg-surface hover:text-white hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background z-30"
              title="Previous Page (Left Arrow)"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
          )}

          {/* Inner container that hugs the image tightly */}
          <div
            key={currentPage}
            id="pageContainer"
            className="relative inline-flex justify-center items-center"
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
                  onError={() => onImageError(currentPageItem.url)}
                  className="max-w-full max-h-[calc(100vh-160px)] sm:max-h-[calc(100vh-180px)] w-auto h-auto object-contain drop-shadow-sm select-none block"
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
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-xl backdrop-blur-xs transition-all duration-150 hover:bg-surface hover:text-white hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background z-30"
              title="Next Page (Right Arrow)"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
          )}

          {/* Floating Page Badge */}
          <div className="absolute bottom-2 bg-background/90 backdrop-blur-xs text-foreground text-xs font-medium px-3.5 py-1.5 rounded-full border border-border shadow-md pointer-events-none z-30" aria-live="polite">
            <span className="sr-only">หน้าปัจจุบัน: </span>{currentPage + 1} / {pages.length}
          </div>
        </div>
      )}
    </div>
  );
}
