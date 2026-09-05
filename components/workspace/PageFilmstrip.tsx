"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type WheelEvent,
} from "react";
import { Check, ChevronDown, ChevronUp, Trash2, Upload } from "lucide-react";

export interface WorkspacePageItem {
  url: string;
  name: string;
}

export interface PageFilmstripProps {
  pages: WorkspacePageItem[];
  currentPage: number;
  onSelectPage: (index: number) => void;
  onDeletePage: (index: number) => void;
  onReorderPages: (pages: WorkspacePageItem[]) => void;
  onAddImages: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearAll: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isFocusMode?: boolean;
}

export function PageFilmstrip({
  pages,
  currentPage,
  onSelectPage,
  onDeletePage,
  onReorderPages,
  onAddImages,
  onClearAll,
  isCollapsed,
  onToggleCollapse,
  isFocusMode = false,
}: PageFilmstripProps): ReactElement | null {
  const thumbnailContainerRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<"left" | "right" | null>(
    null,
  );

  const handleThumbnailWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    const container = event.currentTarget;
    const maxScrollLeft = Math.max(
      0,
      container.scrollWidth - container.clientWidth,
    );
    const nextScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, container.scrollLeft + event.deltaY),
    );

    if (nextScrollLeft !== container.scrollLeft) {
      event.preventDefault();
      container.scrollLeft = nextScrollLeft;
    }
  };

  if (pages.length === 0) return null;

  return (
    <nav
      role="region"
      aria-label="รายการหน้ามังงะและเครื่องมือจัดการหน้า"
      className={`fixed right-0 bottom-0 left-0 z-30 flex min-w-0 flex-col items-center border-t border-surface-hover/80 bg-background/95 backdrop-blur-md transition-all duration-200 ease-out ${
        isFocusMode
          ? "translate-y-[150%] opacity-0 pointer-events-none"
          : isCollapsed
            ? "translate-y-full"
            : "translate-y-0"
      }`}
    >
      {/* Collapse/Expand Toggle Button */}
      <button
        type="button"
        aria-expanded={!isCollapsed}
        aria-controls="page-filmstrip"
        aria-label={isCollapsed ? `แสดงหน้าตัวอย่าง ทั้งหมด ${pages.length} หน้า` : "ซ่อนแถบหน้าตัวอย่าง"}
        onClick={onToggleCollapse}
        className="-top-7 absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-t-lg border border-b-0 border-border bg-background px-3.5 py-1 text-xs font-medium text-muted shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title={isCollapsed ? "Show Thumbnails" : "Hide Thumbnails"}
      >
        {isCollapsed ? (
          <>
            <ChevronUp className="h-3.5 w-3.5 text-muted" />
            <span>
              Pages ({currentPage + 1}/{pages.length})
            </span>
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5 text-muted" />
            <span>ซ่อนหน้าตัวอย่าง</span>
          </>
        )}
      </button>

      <div
        id="page-filmstrip"
        ref={thumbnailContainerRef}
        onWheel={handleThumbnailWheel}
        className="flex h-20 w-full max-w-full min-w-0 touch-pan-x items-center gap-3 overflow-x-auto overscroll-x-contain px-4 sm:h-22 [scrollbar-width:thin]"
      >
        {pages.map((page, i) => {
          const isSelected = i === currentPage;
          return (
            <div
              key={i}
              className={`group relative flex-shrink-0 ${
                dragOverIndex === i && dragIndex !== i
                  ? dragPosition === "left"
                    ? "before:absolute before:-left-1.5 before:inset-y-1 before:z-20 before:w-0.5 before:rounded-full before:bg-primary"
                    : "after:absolute after:-right-1.5 after:inset-y-1 after:z-20 after:w-0.5 after:rounded-full after:bg-primary"
                  : ""
              }`}
            >
              <button
                type="button"
                draggable
                data-page-index={i}
                aria-label={`หน้า ${i + 1} จาก ${pages.length}: ${page.name}${isSelected ? ", หน้าที่เลือกอยู่" : ""}`}
                aria-current={isSelected ? "page" : undefined}
                onFocus={(e) => {
                  e.currentTarget.scrollIntoView({
                    behavior: "smooth",
                    inline: "nearest",
                    block: "nearest",
                  });
                }}
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.stopPropagation();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverIndex(i);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDragPosition(
                    e.clientX - rect.left > rect.width / 2 ? "right" : "left",
                  );
                }}
                onDragLeave={() => {
                  setDragOverIndex(null);
                  setDragPosition(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragIndex !== null) {
                    const targetIndex = dragPosition === "right" ? i + 1 : i;

                    if (dragIndex !== targetIndex && dragIndex !== targetIndex - 1) {
                      const updated = [...pages];
                      const [moved] = updated.splice(dragIndex, 1);
                      const finalIndex =
                        dragIndex < targetIndex ? targetIndex - 1 : targetIndex;
                      updated.splice(finalIndex, 0, moved);
                      onReorderPages(updated);
                      if (currentPage === dragIndex) {
                        onSelectPage(finalIndex);
                      } else if (
                        dragIndex < currentPage &&
                        finalIndex >= currentPage
                      ) {
                        onSelectPage(currentPage - 1);
                      } else if (
                        dragIndex > currentPage &&
                        finalIndex <= currentPage
                      ) {
                        onSelectPage(currentPage + 1);
                      }
                    }
                  }
                  setDragIndex(null);
                  setDragOverIndex(null);
                  setDragPosition(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDragOverIndex(null);
                  setDragPosition(null);
                }}
                onClick={() => {
                  onSelectPage(i);
                }}
                className={`relative flex-shrink-0 min-w-[48px] sm:min-w-[56px] cursor-grab overflow-hidden rounded-lg border transition-all duration-150 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none ${
                  isSelected
                    ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md opacity-100"
                    : "border-border opacity-80 hover:opacity-100 hover:border-muted"
                } ${dragIndex === i ? "scale-90 opacity-30" : ""}`}
                title={`${page.name} (หน้า ${i + 1}/${pages.length}) — ลากเพื่อสลับหน้า`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.url}
                  alt={`หน้า ${i + 1}: ${page.name}`}
                  className="pointer-events-none h-14 w-auto object-cover sm:h-[72px]"
                />

                {/* Selected Checkmark Badge (Non-color reliant state) */}
                {isSelected && (
                  <span
                    className="absolute top-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-content shadow-xs"
                    aria-hidden="true"
                  >
                    <Check className="h-3 w-3 stroke-[3]" />
                  </span>
                )}

                {/* High-Contrast Page Number Caption */}
                <span
                  className={`absolute inset-x-0 bottom-0 py-0.5 px-1 text-center text-xs font-semibold tracking-wider ${
                    isSelected
                      ? "bg-primary text-primary-content font-bold"
                      : "bg-black/85 text-foreground border-t border-black/50 group-hover:text-white"
                  }`}
                >
                  {i + 1}
                </span>
              </button>

              {/* Remove Page Button */}
              <button
                type="button"
                aria-label={`ลบหน้า ${i + 1}: ${page.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeletePage(i);
                }}
                className="absolute -top-1.5 -right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-red-600 text-white opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none shadow-sm"
                title="Remove image"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          );
        })}

        {/* Add more pages button */}
        <label
          className="flex h-15 min-w-[52px] flex-shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border border-dashed bg-surface/50 text-foreground transition-colors duration-150 hover:border-primary hover:text-primary focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2"
          title="Add more pages"
          aria-label="เพิ่มรูปภาพมังงะ"
        >
          <Upload className="mb-0.5 h-4 w-4 text-muted" aria-hidden="true" />
          <span className="text-[10px] font-medium">Add</span>
          <input
            type="file"
            multiple
            accept="image/*,.zip,.cbz,.pdf"
            className="sr-only"
            aria-label="เลือกไฟล์มังงะเพื่อเพิ่ม"
            onChange={onAddImages}
          />
        </label>

        {/* Clear All button */}
        {pages.length > 1 && (
          <button
            type="button"
            onClick={() => {
              if (confirm("ลบรูปภาพทั้งหมดใช่ไหม?")) {
                onClearAll();
              }
            }}
            aria-label="ลบรูปภาพมังงะทั้งหมดในโปรเจกต์"
            className="flex h-15 min-w-[52px] flex-shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border border-dashed bg-surface/50 text-muted transition-colors duration-150 hover:border-red-500/80 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            title="ลบรูปทั้งหมด"
          >
            <Trash2 className="mb-0.5 h-4 w-4" aria-hidden="true" />
            <span className="text-[10px] font-medium">Clear</span>
          </button>
        )}
      </div>
    </nav>
  );
}
