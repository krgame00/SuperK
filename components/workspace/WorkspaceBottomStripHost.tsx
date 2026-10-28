"use client";

import { type ChangeEvent, type ReactElement } from "react";
import { PageFilmstrip } from "@/components/workspace/PageFilmstrip";
import { RemnantReviewPanel } from "@/components/cleaning/RemnantReviewPanel";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { PixelRect, CleaningRegion } from "@/lib/cleaning/types";
import type {
  BackgroundInspectionResult,
  RemnantCandidate,
} from "@/lib/cleaning/backgroundRemnantInspection";

export interface WorkspaceBottomStripHostProps {
  // PageFilmstrip props
  pages: WorkspaceExportPage[];
  currentPage: number;
  onSelectPage: (index: number) => void;
  onDeletePage: (index: number) => void;
  onReorderPages: (pages: WorkspaceExportPage[]) => void;
  onAddImages: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearAll: () => void;
  isThumbnailsCollapsed: boolean;
  onToggleCollapse: () => void;
  isFocusMode: boolean;

  // RemnantReviewPanel props
  currentCleaningResult: PageCleaningResult | null | undefined;
  currentPageUrl?: string;
  canConfirmHumanInspection?: boolean;
  remnantInspection?: BackgroundInspectionResult;
  onOpenMaskCandidate: (candidate: { id?: string; rect: PixelRect }) => void;
  onRestoreOriginalRemnant?: (
    candidate: RemnantCandidate,
    region: CleaningRegion | undefined,
  ) => Promise<void> | void;
  onCleanRemnantCandidate?: (
    candidate: RemnantCandidate,
    region: CleaningRegion | undefined,
  ) => Promise<void> | void;
  onConfirmArtworkCandidate: (candidateId: string) => void;
  onConfirmAllPageRemnants: () => void;
  onConfirmHumanInspection: (
    revisionKey: string,
    sourceUrl: string,
    cleanUrl: string,
  ) => void;
  onRecheckPageRemnants: () => void;
  toolbarPosition?: "top" | "bottom";
  isPageReviewRequired?: boolean;
}

export function WorkspaceBottomStripHost({
  pages,
  currentPage,
  onSelectPage,
  onDeletePage,
  onReorderPages,
  onAddImages,
  onClearAll,
  isThumbnailsCollapsed,
  onToggleCollapse,
  isFocusMode,
  currentCleaningResult,
  currentPageUrl,
  canConfirmHumanInspection,
  remnantInspection,
  onOpenMaskCandidate,
  onRestoreOriginalRemnant,
  onCleanRemnantCandidate,
  onConfirmArtworkCandidate,
  onConfirmAllPageRemnants,
  onConfirmHumanInspection,
  onRecheckPageRemnants,
  toolbarPosition,
  isPageReviewRequired,
}: WorkspaceBottomStripHostProps): ReactElement {
  const activePage = pages[currentPage];

  return (
    <>
      {/* Bottom Thumbnail Strip */}
      <PageFilmstrip
        pages={pages}
        currentPage={currentPage}
        onSelectPage={onSelectPage}
        onDeletePage={onDeletePage}
        onReorderPages={onReorderPages}
        onAddImages={onAddImages}
        onClearAll={onClearAll}
        isCollapsed={isThumbnailsCollapsed}
        onToggleCollapse={onToggleCollapse}
        isFocusMode={isFocusMode}
      />

      <RemnantReviewPanel
        sourceUrl={activePage?.url}
        cleanUrl={currentCleaningResult?.cleanUrl}
        dimensions={
          currentCleaningResult
            ? {
                width: currentCleaningResult.width,
                height: currentCleaningResult.height,
              }
            : undefined
        }
        canConfirmHumanInspection={canConfirmHumanInspection ?? false}
        inspection={remnantInspection}
        regions={currentCleaningResult?.regions ?? []}
        onOpenMask={onOpenMaskCandidate}
        onRestoreOriginal={onRestoreOriginalRemnant}
        onCleanCandidate={onCleanRemnantCandidate}
        onConfirmArtwork={(candidate) => {
          if (currentPageUrl) onConfirmArtworkCandidate(candidate.id);
        }}
        onConfirmAllArtwork={() => {
          if (currentPageUrl) {
            onConfirmAllPageRemnants();
          }
        }}
        onConfirmHumanInspection={(revisionKey, sourceUrl, cleanUrl) => {
          if (currentPageUrl) {
            onConfirmHumanInspection(revisionKey, sourceUrl, cleanUrl);
          }
        }}
        onReimportSource={() =>
          document
            .querySelector<HTMLInputElement>(
              'input[aria-label="เลือกไฟล์มังงะเพื่อเพิ่ม"]',
            )
            ?.click()
        }
        onRecheck={() => {
          if (currentPageUrl) void onRecheckPageRemnants();
        }}
        toolbarPosition={toolbarPosition}
        isPageReviewRequired={isPageReviewRequired}
      />
    </>
  );
}
