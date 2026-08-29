"use client";

import { useRef, type ReactElement } from "react";
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
        <div className="flex flex-col items-center gap-0 w-full max-w-3xl sm:max-w-4xl lg:max-w-5xl pb-32">
          {pages.map((p, idx) => {
            const isTranslated = translatedImagesMap?.has(p.url) ?? false;
            const cleanedSrc =
              cleaningResultsByPage.get(p.url)?.cleanUrl ?? p.url;
            const cachedTranslated = translatedImagesMap?.get(p.url);
            const translatedBlobUrl =
              cachedTranslated?.startsWith("data:")
                ? URL.createObjectURL(dataUrlToBlob(cachedTranslated))
                : cachedTranslated;
            const imgSrc =
              workspaceLayer === "original"
                ? p.url
                : workspaceLayer === "translated" && isTranslated
                  ? translatedBlobUrl ?? cleanedSrc
                  : cleanedSrc;
            return (
              <div
                key={idx}
                className="w-full relative cursor-pointer hover:opacity-95 transition-opacity"
                onClick={() => {
                  onPageChange(idx);
                  onViewLayoutChange("single");
                }}
                title="Click to edit this page"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={`Page ${idx + 1}`}
                  className="w-full h-auto object-contain block m-0 p-0"
                />
                <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2.5 py-1 rounded-md opacity-0 hover:opacity-100 pointer-events-none transition-opacity">
                  {idx + 1} / {pages.length}
                </div>
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
              onClick={() => onPageChange((prev) => prev - 1)}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-surface text-foreground p-2 rounded-full shadow-lg border border-surface-hover z-30 transition-all opacity-80 hover:opacity-100 hover:scale-110 active:scale-95"
              title="Previous Page (Left Arrow)"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
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
                  onClick={() => onRemovePage(currentPage)}
                  className="bg-red-500/20 text-red-400 hover:bg-red-500/30 px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer"
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
                  alt={currentPageItem.name}
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
              onClick={() => onPageChange((prev) => prev + 1)}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-surface text-foreground p-2 rounded-full shadow-lg border border-surface-hover z-30 transition-all opacity-80 hover:opacity-100 hover:scale-110 active:scale-95"
              title="Next Page (Right Arrow)"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          {/* Floating Page Badge */}
          <div className="absolute bottom-2 bg-background/80 backdrop-blur-xs text-foreground text-xs px-3 py-1 rounded-full border border-surface-hover shadow-sm pointer-events-none z-30">
            {currentPage + 1} / {pages.length}
          </div>
        </div>
      )}
    </div>
  );
}
