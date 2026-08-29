"use client";

import { useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { ChevronDown, ChevronUp, Trash2, Upload } from "lucide-react";

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
}: PageFilmstripProps): ReactElement | null {
  const thumbnailContainerRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<"left" | "right" | null>(
    null,
  );

  if (pages.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="รายการหน้ามังงะ"
      className={`fixed right-0 bottom-0 left-0 z-30 flex flex-col items-center border-t border-surface bg-background/95 backdrop-blur-md transition-transform duration-200 ${
        isCollapsed ? "translate-y-[calc(100%-28px)]" : "translate-y-0"
      }`}
    >
      {/* Collapse/Expand Toggle Button */}
      <button
        type="button"
        aria-expanded={!isCollapsed}
        aria-controls="page-filmstrip"
        onClick={onToggleCollapse}
        className="-top-7 absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-t-lg border border-b-0 border-surface bg-background px-3 py-1 text-xs text-muted shadow-sm hover:text-foreground"
        title={isCollapsed ? "Show Thumbnails" : "Hide Thumbnails"}
      >
        {isCollapsed ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" />
            <span>
              Pages ({currentPage + 1}/{pages.length})
            </span>
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" />
            <span>ซ่อนหน้าตัวอย่าง</span>
          </>
        )}
      </button>

      <div
        id="page-filmstrip"
        ref={thumbnailContainerRef}
        className="flex h-20 items-center gap-2.5 overflow-x-auto overscroll-x-contain px-3 sm:h-24 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((page, i) => (
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
              aria-label={`หน้า ${i + 1}: ${page.name}`}
              aria-current={i === currentPage ? "page" : undefined}
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
              className={`relative flex-shrink-0 cursor-grab overflow-hidden rounded-md border border-transparent transition-[opacity,transform,box-shadow] duration-150 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 motion-reduce:transition-none ${
                i === currentPage
                  ? "opacity-100 ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "opacity-75 hover:opacity-100"
              } ${dragIndex === i ? "scale-90 opacity-30" : ""}`}
              title={`${page.name} — drag to reorder`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.url}
                alt={page.name}
                className="pointer-events-none h-14 w-auto object-cover sm:h-[72px]"
              />
              <span
                className={`absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] font-medium ${
                  i === currentPage
                    ? "bg-primary text-primary-content"
                    : "bg-black/75 text-white/90 group-hover:text-white"
                }`}
              >
                {i + 1}
              </span>
            </button>
            <button
              type="button"
              aria-label={`ลบหน้า ${i + 1}: ${page.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDeletePage(i);
              }}
              className="absolute -top-1.5 -right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-red-500 text-white opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white motion-reduce:transition-none"
              title="Remove image"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}

        {/* Add more pages button */}
        <label
          className="flex h-16 w-14 flex-shrink-0 cursor-pointer flex-col items-center justify-center rounded-md border border-surface-hover border-dashed text-muted transition-colors duration-150 hover:border-muted hover:text-foreground"
          title="Add more pages"
        >
          <Upload className="mb-0.5 h-4 w-4" />
          <span className="text-[10px]">Add</span>
          <input
            type="file"
            multiple
            accept="image/*,.zip,.cbz,.pdf"
            className="hidden"
            onChange={onAddImages}
          />
        </label>

        {/* Clear All button */}
        {pages.length > 1 && (
          <button
            onClick={() => {
              if (confirm("ลบรูปภาพทั้งหมดใช่ไหม?")) {
                onClearAll();
              }
            }}
            className="flex h-16 w-14 flex-shrink-0 cursor-pointer flex-col items-center justify-center rounded-md border border-surface-hover border-dashed text-muted transition-colors duration-150 hover:border-red-500/50 hover:text-red-500"
            title="ลบรูปทั้งหมด"
          >
            <Trash2 className="mb-0.5 h-4 w-4" />
            <span className="text-[10px]">Clear All</span>
          </button>
        )}
      </div>
    </div>
  );
}
