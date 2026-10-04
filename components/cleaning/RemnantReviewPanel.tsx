"use client";

import { Eraser, ImageOff, Sparkles } from "lucide-react";

import type {
  BackgroundInspectionResult,
  BackgroundInspectionUnverifiedReason,
  RemnantCandidate,
} from "@/lib/cleaning/backgroundRemnantInspection";
import { findRegionForCandidate } from "@/lib/cleaning/remnantReview";
import type { CleaningRegion } from "@/lib/cleaning/types";

export interface RemnantReviewPanelProps {
  inspection?: BackgroundInspectionResult;
  regions: CleaningRegion[];
  /** Open the mask editor on the candidate's authorized removal region. */
  onOpenMask?: (candidate: RemnantCandidate, region: CleaningRegion | undefined) => void;
  /** Confirm this exact candidate (this revision) is artwork. */
  onConfirmArtwork?: (candidate: RemnantCandidate) => void;
  /** Re-run local inspection for unverified evidence. */
  onRecheck?: () => void;
}

const UNVERIFIED_LABELS: Record<BackgroundInspectionUnverifiedReason, string> = {
  "missing-revisions": "ข้อมูลรอบการแก้ไขของภาพไม่ครบ จึงตรวจสอบอัตโนมัติไม่ได้",
  "missing-original": "ไม่พบภาพต้นฉบับที่ใช้เปรียบเทียบ จึงตรวจสอบอัตโนมัติไม่ได้",
  "missing-clean": "ไม่พบภาพพื้นหลังที่คลีนแล้ว จึงตรวจสอบอัตโนมัติไม่ได้",
  "dimension-mismatch": "ขนาดภาพต้นฉบับกับภาพที่คลีนไม่ตรงกัน จึงตรวจสอบอัตโนมัติไม่ได้",
  "detection-failed": "การตรวจสอบอัตโนมัติล้มเหลว",
  "no-removal-evidence": "ไม่มีขอบเขตข้อความหรือพื้นที่คลีนให้ตรวจสอบ",
};

const STATE_LABELS: Record<RemnantCandidate["state"], string> = {
  "suspected-remnant": "สงสัยว่าเป็นข้อความต้นฉบับที่ยังเหลืออยู่",
  "unchanged-candidate": "ข้อความต้นฉบับที่ยังไม่ได้ถูกคลีน",
  uncertain: "ไม่แน่ใจ อาจเป็นลายเส้นหรือเงาของภาพ",
  "human-confirmed-artwork": "ยืนยันลายภาพแล้ว",
};

const DETAIL_LABELS: Record<RemnantCandidate["detail"], string> = {
  "full-glyph": "เหลือทั้งอักขระ",
  "partial-glyph": "เหลือบางส่วนของอักขระ",
  unchanged: "ยังไม่ถูกลบเลย",
  "line-like": "เป็นเส้นบาง/ลายเส้น",
};

/**
 * Review chrome for background-remnant findings on the current page.
 * Findings are locations + evidence only: resolution is either a bounded mask
 * correction in the mask editor or an artwork confirmation scoped to the exact
 * candidate and image revision. Unverified evidence always asks for explicit
 * human image inspection and is never presented as clean.
 */
export function RemnantReviewPanel({
  inspection,
  regions,
  onOpenMask,
  onConfirmArtwork,
  onRecheck,
}: RemnantReviewPanelProps) {
  if (!inspection) return null;

  if (inspection.status === "unverified") {
    return (
      <div
        role="alert"
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
        data-testid="remnant-review-unverified"
      >
        <span className="flex items-center gap-2 font-medium text-amber-500">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
          {inspection.unverifiedReason
            ? UNVERIFIED_LABELS[inspection.unverifiedReason]
            : "ตรวจสอบพื้นหลังอัตโนมัติไม่ได้"}
          {" "}ต้องตรวจสอบภาพด้วยตนเองก่อนใช้งาน
        </span>
        {onRecheck && (
          <button
            type="button"
            onClick={onRecheck}
            className="rounded bg-amber-700 px-3 py-1.5 font-semibold text-white hover:bg-amber-600 focus-visible:outline-2"
          >
            ตรวจสอบอีกครั้ง
          </button>
        )}
      </div>
    );
  }

  const openCandidates = inspection.candidates.filter((candidate) => candidate.state !== "human-confirmed-artwork");
  const confirmedCandidates = inspection.candidates.filter((candidate) => candidate.state === "human-confirmed-artwork");
  if (inspection.candidates.length === 0) return (
    <p role="status" className="w-full rounded-lg border border-border/70 bg-surface/90 px-3 py-2 text-xs text-muted">
      {inspection.truncated
        ? "ตรวจสอบได้ไม่ครบ ต้องตรวจสอบภาพด้วยตนเอง"
        : "ไม่พบจุดสงสัยในขอบเขตที่ตรวจสอบ การเปรียบเทียบภาพอาจพลาดข้อความจางหรือข้อความที่คล้ายลายภาพ"}
    </p>
  );

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-border/70 bg-surface/90 px-3 py-2 text-xs" data-testid="remnant-review-findings">
      <p className="font-semibold text-foreground">
        พบจุดสงสัยว่ามีข้อความต้นฉบับหลงเหลือบนภาพคลีน {openCandidates.length} จุด
        {confirmedCandidates.length > 0 && ` (ยืนยันลายภาพแล้ว ${confirmedCandidates.length} จุด)`}
      </p>
      <ul className="flex flex-col gap-2">
        {[...openCandidates, ...confirmedCandidates].map((candidate) => {
          const region = findRegionForCandidate(regions, candidate.rect);
          const confirmed = candidate.state === "human-confirmed-artwork";
          return (
            <li
              key={candidate.id}
              data-testid={`remnant-candidate-${candidate.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background/70 px-2.5 py-1.5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-foreground">
                  ตำแหน่ง x{candidate.rect.x} y{candidate.rect.y} ({candidate.rect.width}×{candidate.rect.height})
                  {" · "}{DETAIL_LABELS[candidate.detail]}
                  {" · "}{Math.round(candidate.confidence * 100)}%
                </span>
                <span className="text-muted">
                  {STATE_LABELS[candidate.state]} · ความมืดต้นฉบับ/หลังคลีน {candidate.evidence.meanLumaOriginal}/{candidate.evidence.meanLumaClean}
                  {" · "}หมึกที่ยังเหลือ {candidate.evidence.survivingInkPixels} พิกเซล
                </span>
              </span>
              {!confirmed && (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!region}
                    title={region ? "เปิดแก้ Mask ที่บริเวณนี้ (เทียบภาพเดิม/ภาพคลีน)" : "จุดนี้ไม่อยู่ในพื้นที่คลีนที่อนุมัติ จึงแก้ Mask ไม่ได้"}
                    onClick={() => region && onOpenMask?.(candidate, region)}
                    className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 font-semibold text-primary-content hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                    แก้ Mask ที่จุดนี้
                  </button>
                  <button
                    type="button"
                    onClick={() => onConfirmArtwork?.(candidate)}
                    className="flex items-center gap-1 rounded-md bg-surface px-2.5 py-1.5 font-medium text-foreground hover:bg-surface-hover"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    ยืนยันเป็นลายภาพ
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
