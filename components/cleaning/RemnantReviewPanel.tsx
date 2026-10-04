"use client";

import { Eraser, ImageOff, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  sourceUrl?: string;
  cleanUrl?: string;
  dimensions?: { width: number; height: number };
  canConfirmHumanInspection?: boolean;
  onConfirmHumanInspection?: (revisionKey: string, sourceUrl: string, cleanUrl: string) => void;
  onReimportSource?: () => void;
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
  sourceUrl,
  cleanUrl,
  dimensions,
  canConfirmHumanInspection,
  onConfirmHumanInspection,
  onReimportSource,
  onOpenMask,
  onConfirmArtwork,
  onRecheck,
}: RemnantReviewPanelProps) {
  const [comparison, setComparison] = useState<{ candidate: RemnantCandidate; revisionKey: string; sourceUrl: string; cleanUrl: string }>();
  const [wholeComparison, setWholeComparison] = useState<{ revisionKey: string; sourceUrl: string; cleanUrl: string; loaded: number }>();
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const closeComparison = () => { setComparison(undefined); returnFocus.current?.focus(); };
  if (!inspection) return null;

  if (inspection.status === "unverified") {
    const humanConfirmed = inspection.humanImageInspection?.revisionKey === inspection.revisionKey;
    return (
      <div
        role="alert"
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
        data-testid="remnant-review-unverified"
      >
        <span className="flex items-center gap-2 font-medium text-amber-500">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
          {humanConfirmed
            ? "ตรวจภาพต้นฉบับเทียบภาพคลีนด้วยตนเองแล้ว สำหรับภาพและ Mask รอบนี้"
            : <>{inspection.unverifiedReason ? UNVERIFIED_LABELS[inspection.unverifiedReason] : "ตรวจสอบพื้นหลังอัตโนมัติไม่ได้"}{" "}ต้องตรวจสอบภาพด้วยตนเองก่อนใช้งาน</>}
        {inspection.unverifiedReason === "missing-original" && " กรุณานำเข้าหน้านี้ใหม่เพื่อให้มีภาพต้นฉบับ"}
        {inspection.unverifiedReason === "missing-original" && onReimportSource && (
          <button type="button" onClick={onReimportSource} className="rounded bg-primary px-3 py-1.5 font-semibold text-primary-content">นำภาพต้นฉบับเข้ามาใหม่</button>
        )}
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
        {sourceUrl && cleanUrl && dimensions?.width && dimensions.height && (
          <button type="button" onClick={() => setWholeComparison({ revisionKey: inspection.revisionKey, sourceUrl, cleanUrl, loaded: 0 })}
            className="rounded bg-surface px-3 py-1.5 font-semibold text-foreground hover:bg-surface-hover">
            เทียบภาพต้นฉบับกับภาพคลีนทั้งหน้า
          </button>
        )}
        {!humanConfirmed && canConfirmHumanInspection && sourceUrl && cleanUrl && (
          <span className="text-muted">ตรวจภาพทั้งหน้าแล้วกดยืนยันได้หลังภาพทั้งสองโหลดครบ</span>
        )}
        {inspection.candidates.length > 0 && (
          <ul className="flex w-full flex-col gap-2" aria-label="จุดที่ยังต้องแก้แยกจุด">
            {inspection.candidates.map(candidate => {
              const region = findRegionForCandidate(regions, candidate.rect);
              const confirmed = candidate.state === "human-confirmed-artwork";
              return <li key={candidate.id} className="flex flex-wrap items-center gap-2 rounded border border-border/60 p-2">
                <span>ตำแหน่ง x{candidate.rect.x} y{candidate.rect.y} ({candidate.rect.width}×{candidate.rect.height}) · {STATE_LABELS[candidate.state]}</span>
                {sourceUrl && cleanUrl && <button type="button" className="rounded bg-surface px-2 py-1" onClick={event => {
                  returnFocus.current = event.currentTarget;
                  setComparison({ candidate, revisionKey: inspection.revisionKey, sourceUrl, cleanUrl });
                }}>เทียบจุดนี้</button>}
                {!confirmed && <>
                  <button type="button" disabled={!region} className="rounded bg-primary px-2 py-1 text-primary-content disabled:opacity-40"
                    onClick={() => region && onOpenMask?.(candidate, region)}>แก้ Mask จุดนี้</button>
                  <button type="button" className="rounded bg-surface px-2 py-1" onClick={() => onConfirmArtwork?.(candidate)}>ยืนยันจุดนี้เป็นลายภาพ</button>
                </>}
              </li>;
            })}
          </ul>
        )}
        {wholeComparison && dimensions && wholeComparison.revisionKey === inspection.revisionKey && wholeComparison.sourceUrl === sourceUrl && wholeComparison.cleanUrl === cleanUrl && (
          <WholeImageComparison comparison={wholeComparison} dimensions={dimensions} canConfirm={!!canConfirmHumanInspection}
            onLoaded={() => setWholeComparison(current => current?.revisionKey === inspection.revisionKey ? { ...current, loaded: Math.min(2, current.loaded + 1) } : current)}
            onConfirm={() => { onConfirmHumanInspection?.(inspection.revisionKey, sourceUrl!, cleanUrl!); setWholeComparison(undefined); }}
            onClose={() => setWholeComparison(undefined)} />
        )}
        {comparison && dimensions && comparison.revisionKey === inspection.revisionKey && comparison.sourceUrl === sourceUrl && comparison.cleanUrl === cleanUrl && (
          <CandidateComparison candidate={comparison.candidate} sourceUrl={comparison.sourceUrl} cleanUrl={comparison.cleanUrl} dimensions={dimensions} onClose={closeComparison} />
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
              <button type="button" disabled={!sourceUrl || !cleanUrl || !dimensions?.width || !dimensions?.height}
                className="rounded-md bg-surface px-2.5 py-1.5 font-medium text-foreground hover:bg-surface-hover disabled:opacity-40"
                onClick={(event) => {
                  if (!sourceUrl || !cleanUrl) return;
                  returnFocus.current = event.currentTarget;
                  setComparison({ candidate, revisionKey: inspection.revisionKey, sourceUrl, cleanUrl });
                }}>
                เปรียบเทียบภาพเดิม/ภาพคลีน
              </button>
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
      {comparison && dimensions && comparison.revisionKey === inspection.revisionKey && comparison.sourceUrl === sourceUrl && comparison.cleanUrl === cleanUrl && (
        <CandidateComparison candidate={comparison.candidate} sourceUrl={comparison.sourceUrl} cleanUrl={comparison.cleanUrl} dimensions={dimensions} onClose={closeComparison} />
      )}
    </div>
  );
}

function WholeImageComparison({ comparison, dimensions, canConfirm, onLoaded, onConfirm, onClose }: {
  comparison: { revisionKey: string; sourceUrl: string; cleanUrl: string; loaded: number };
  dimensions: { width: number; height: number }; canConfirm: boolean;
  onLoaded: () => void; onConfirm: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.focus(); }, []);
  const loaded = useRef(new Set<string>());
  const markLoaded = (key: string) => { if (!loaded.current.has(key)) { loaded.current.add(key); onLoaded(); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="เทียบภาพต้นฉบับกับภาพคลีนทั้งหน้า" tabIndex={-1}
        className="max-h-[94vh] max-w-[96vw] overflow-auto rounded-lg bg-surface p-4 text-foreground"
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
        <p className="mb-3 font-semibold">ตรวจภาพทั้งหน้า · การยืนยันอนุมัติเฉพาะภาพและ Mask รอบนี้</p>
        <div className="flex flex-wrap items-start justify-center gap-4">
          {[["ภาพต้นฉบับ", comparison.sourceUrl, "source"], ["ภาพคลีน", comparison.cleanUrl, "clean"]].map(([label, url, key]) => (
            <figure key={key} className="min-w-0">
              <figcaption className="mb-2">{label}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={label} draggable={false} onLoad={() => markLoaded(key)}
                style={{ display: "block", width: "auto", height: "auto", maxWidth: "43vw", maxHeight: "76vh", objectFit: "contain", aspectRatio: `${dimensions.width}/${dimensions.height}` }} />
            </figure>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded bg-surface-hover px-3 py-2">ปิด</button>
          <button type="button" disabled={!canConfirm || comparison.loaded < 2} onClick={onConfirm}
            className="rounded bg-primary px-3 py-2 font-semibold text-primary-content disabled:opacity-40">
            {comparison.loaded < 2 ? "กำลังโหลดภาพ…" : canConfirm ? "ยืนยันว่าตรวจภาพทั้งหน้าแล้ว" : "ยังยืนยันไม่ได้"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateComparison({ candidate, sourceUrl, cleanUrl, dimensions, onClose }: {
  candidate: RemnantCandidate; sourceUrl: string; cleanUrl: string;
  dimensions: { width: number; height: number }; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="เปรียบเทียบจุดสงสัย" tabIndex={-1}
        className="max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg bg-surface p-4 text-foreground"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key === "Tab") { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
        }}>
        <p className="mb-3 font-semibold">เปรียบเทียบจุดสงสัย · x{candidate.rect.x} y{candidate.rect.y}</p>
        <div className="flex flex-wrap gap-4">
          {[["ภาพต้นฉบับ", sourceUrl], ["ภาพคลีน", cleanUrl]].map(([label, url]) => (
            <figure key={label}>
              <figcaption className="mb-2">{label}</figcaption>
              <div style={{ position: "relative", overflow: "hidden", width: candidate.rect.width, height: candidate.rect.height }}>
                {/* Immutable page assets, clipped in source pixels; no canvas or mask writes. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={label} draggable={false} style={{ position: "absolute", maxWidth: "none", width: dimensions.width, height: dimensions.height, left: -candidate.rect.x, top: -candidate.rect.y }} />
              </div>
            </figure>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-4 rounded bg-primary px-3 py-2 text-primary-content">ปิดการเปรียบเทียบ</button>
      </div>
    </div>
  );
}
