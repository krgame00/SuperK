"use client";

import { ArrowLeftRight, ChevronDown, Eraser, ImageOff, Minimize2, Sparkles, X } from "lucide-react";
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
  const [side, setSide] = useState<"right" | "left">("right");
  const [isCollapsed, setIsCollapsed] = useState(false);
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
    <div
      role="region"
      aria-label="รายการจุดตรวจข้อความที่เหลือ"
      className={`fixed top-28 sm:top-32 z-40 flex flex-col overflow-hidden rounded-2xl transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        side === "right" ? "right-3 sm:right-4 origin-top-right" : "left-3 sm:left-4 origin-top-left"
      } ${
        isCollapsed
          ? "w-auto max-w-[280px] border border-[#e61972]/50 bg-surface/95 px-3 py-1.5 shadow-lg backdrop-blur-md"
          : "w-[calc(100%-2rem)] max-w-sm sm:max-w-md md:max-w-[420px] max-h-[calc(100vh-10.5rem)] border border-border/80 bg-surface/95 p-3 text-xs shadow-2xl backdrop-blur-md"
      }`}
      data-testid="remnant-review-findings"
    >
      {isCollapsed ? (
        <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200 select-none">
          <span className="relative flex h-2.5 w-2.5 items-center justify-center">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e61972] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#e61972]" />
          </span>
          <span className="font-semibold text-foreground text-xs whitespace-nowrap">
            จุดสงสัย {openCandidates.length} จุด
          </span>
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="inline-flex items-center gap-1 rounded-xl bg-primary/15 hover:bg-primary/25 active:scale-95 text-primary px-2.5 py-0.5 font-semibold text-xs transition-all cursor-pointer ml-1"
            aria-label="ขยายพาเนล"
          >
            <span>แสดง</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-2">
            <div className="flex items-start gap-2 min-w-0">
              <span className="relative flex h-2.5 w-2.5 shrink-0 mt-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e61972] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#e61972]" />
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className="font-semibold text-foreground text-xs leading-snug">
                  พบจุดสงสัยว่ามีข้อความต้นฉบับหลงเหลือบนภาพคลีน {openCandidates.length} จุด
                  {confirmedCandidates.length > 0 && ` (ยืนยันลายภาพแล้ว ${confirmedCandidates.length} จุด)`}
                </p>
                {openCandidates.length > 4 && (
                  <span className="text-[11px] font-normal text-muted">
                    เลื่อนภายในกรอบเพื่อดูรายการที่เหลือ
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setSide((s) => (s === "right" ? "left" : "right"))}
                title={side === "right" ? "สลับพาเนลไปฝั่งซ้าย" : "สลับพาเนลไปฝั่งขวา"}
                aria-label={side === "right" ? "สลับพาเนลไปฝั่งซ้าย" : "สลับพาเนลไปฝั่งขวา"}
                className="rounded-lg p-1 text-muted hover:bg-surface-hover hover:text-foreground transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                title="ย่อพาเนล"
                aria-label="ย่อพาเนล"
                className="rounded-lg p-1 text-muted hover:bg-surface-hover hover:text-foreground transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <ul
            data-testid="remnant-candidate-list"
            aria-label="จุดข้อความที่เหลือ · เลื่อนเพื่อดูทั้งหมด"
            tabIndex={0}
            className="flex max-h-[calc(100vh-15rem)] flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]"
          >
            {[...openCandidates, ...confirmedCandidates].map((candidate) => {
              const region = findRegionForCandidate(regions, candidate.rect);
              const confirmed = candidate.state === "human-confirmed-artwork";
              return (
                <li
                  key={candidate.id}
                  data-testid={`remnant-candidate-${candidate.id}`}
                  className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/80 p-2.5 text-xs shadow-sm transition-all hover:border-border"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                      <span className="font-semibold text-foreground">
                        ตำแหน่ง x{candidate.rect.x} y{candidate.rect.y}
                        <span className="font-normal text-muted ml-1">({candidate.rect.width}×{candidate.rect.height})</span>
                      </span>
                      <span className="rounded-lg bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground border border-border/60">
                        {DETAIL_LABELS[candidate.detail]} · {Math.round(candidate.confidence * 100)}%
                      </span>
                    </div>
                    <div className="text-[11px] text-muted leading-tight">
                      <div>{STATE_LABELS[candidate.state]}</div>
                      <div className="mt-0.5 text-[10px] text-muted/80">
                        ความมืดต้นฉบับ/หลังคลีน {candidate.evidence.meanLumaOriginal}/{candidate.evidence.meanLumaClean}
                        {" · "}หมึกที่ยังเหลือ {candidate.evidence.survivingInkPixels} พิกเซล
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 pt-1 border-t border-border/50">
                    <button
                      type="button"
                      disabled={!sourceUrl || !cleanUrl || !dimensions?.width || !dimensions?.height}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 font-medium text-foreground hover:bg-surface-hover disabled:opacity-40 border border-border/60 transition-colors cursor-pointer text-xs"
                      onClick={(event) => {
                        if (!sourceUrl || !cleanUrl) return;
                        returnFocus.current = event.currentTarget;
                        setComparison({ candidate, revisionKey: inspection.revisionKey, sourceUrl, cleanUrl });
                      }}
                    >
                      เปรียบเทียบภาพเดิม/ภาพคลีน
                    </button>
                    {!confirmed && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          disabled={!region}
                          title={region ? "เปิดแก้ Mask ที่บริเวณนี้ (เทียบภาพเดิม/ภาพคลีน)" : "จุดนี้ไม่อยู่ในพื้นที่คลีนที่อนุมัติ จึงแก้ Mask ไม่ได้"}
                          onClick={() => region && onOpenMask?.(candidate, region)}
                          className="flex items-center justify-center gap-1 rounded-lg bg-[#e61972] hover:bg-[#d01564] active:bg-[#b81258] px-2 py-1.5 font-semibold text-white text-xs shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                        >
                          <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                          แก้ Mask ที่จุดนี้
                        </button>
                        <button
                          type="button"
                          onClick={() => onConfirmArtwork?.(candidate)}
                          className="flex items-center justify-center gap-1 rounded-lg bg-surface hover:bg-surface-hover active:bg-surface/80 px-2 py-1.5 font-medium text-foreground text-xs border border-border/60 transition-colors cursor-pointer"
                        >
                          <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                          ยืนยันเป็นลายภาพ
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dialog.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="เปรียบเทียบจุดสงสัย"
        tabIndex={-1}
        className="flex flex-col max-h-[92vh] max-w-[95vw] sm:max-w-4xl w-full rounded-2xl border border-border/80 bg-surface shadow-2xl text-foreground overflow-hidden animate-in zoom-in-95 duration-150"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            event.preventDefault();
            closeButtonRef.current?.focus();
          }
        }}
      >
        {/* Sticky Header with Title and Close (X) button */}
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3 bg-surface-hover/30 shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <p className="font-semibold text-sm">
              เปรียบเทียบจุดสงสัย · x{candidate.rect.x} y{candidate.rect.y}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างเปรียบเทียบ"
            title="ปิดหน้าต่าง (กด Esc หรือคลิกด้านนอก)"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-surface text-muted hover:text-foreground hover:bg-surface-hover active:scale-95 transition-all cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Comparison Area */}
        <div className="flex-1 overflow-auto p-4 flex flex-wrap justify-center gap-6">
          {[["ภาพต้นฉบับ", sourceUrl], ["ภาพคลีน", cleanUrl]].map(([label, url]) => (
            <figure key={label} className="flex flex-col items-center">
              <figcaption className="mb-2 text-xs font-semibold text-muted flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-foreground/40" />
                {label}
              </figcaption>
              <div
                className="rounded-lg border border-border/80 bg-background/50 shadow-inner"
                style={{ position: "relative", overflow: "hidden", width: candidate.rect.width, height: candidate.rect.height }}
              >
                {/* Immutable page assets, clipped in source pixels; no canvas or mask writes. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={label}
                  draggable={false}
                  style={{ position: "absolute", maxWidth: "none", width: dimensions.width, height: dimensions.height, left: -candidate.rect.x, top: -candidate.rect.y }}
                />
              </div>
            </figure>
          ))}
        </div>

        {/* Sticky Footer with Close button (Always visible on screen!) */}
        <div className="border-t border-border/70 px-4 py-3 bg-surface-hover/30 flex justify-end shrink-0">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-xl bg-primary hover:bg-primary-hover active:scale-95 px-4 py-2 text-xs font-semibold text-primary-content shadow-xs transition-all cursor-pointer"
          >
            ปิดการเปรียบเทียบ
          </button>
        </div>
      </div>
    </div>
  );
}
