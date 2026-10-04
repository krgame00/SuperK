/**
 * Background remnant inspection: evidence preparation for "original text left
 * in a cleaned background" review.
 *
 * Design constraints (binding, from .scratch/source-text-remnant-review/spec.md):
 * - Pure observation only. This module never rewrites pixels, never expands a
 *   removal mask, and never calls a provider. Every finding is a review
 *   candidate for a human; nothing is auto-erased.
 * - Inspection is bounded to existing text/removal evidence areas (removal
 *   regions and known text boxes). Artwork, hair and hatching outside those
 *   areas are never scanned and can never be flagged.
 * - Missing or failed evidence is an explicit "unverified" state. It must
 *   never be presented as a clean background.
 * - Findings are bound to exact source/background/removal revision identities.
 *   Reuse is bounded to identical revisions; any change invalidates.
 * - The detection heuristic is deliberately simple and honestly labeled. It
 *   does not perfectly separate stylized text from artwork; ambiguous marks
 *   stay "uncertain" review findings.
 *
 * Integration note: this module consumes plain luma planes, not DOM images, so
 * callers (a later hook) decode the original/clean assets and pass the clean
 * background WITHOUT translated overlays composited.
 */

import { LRUMap } from "../lruMap";
import type { BackgroundEligibilityState } from "../translation/pageEligibility";
import type { PixelRect } from "./types";

/** Bumped when the detection or binding semantics change, invalidating old keys. */
export const BACKGROUND_REMNANT_INSPECTION_VERSION = 1;

/** Single-channel luma plane (0-255). Kept DOM-free so inspection is deterministic and testable. */
export interface GrayscalePlane {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface BackgroundInspectionRevisions {
  /** Original image identity, e.g. StoredCleaningResult.sourceFingerprint. */
  sourceRevision: string;
  /** Clean background identity (the exact cleaned asset revision). */
  backgroundRevision: string;
  /** Removal-evidence identity, e.g. mask fingerprint + region authorization. */
  removalRevision: string;
}

export interface RemnantRemovalRegion {
  id: string;
  rect: PixelRect;
  status: "ready" | "repaired" | "needs_review" | "preserved";
  textRole?: "dialogue" | "narration" | "sfx" | "protected" | "review";
  route?: "flat" | "gradient" | "artwork";
}

export interface RemnantTextEvidence {
  id: string;
  /** Bounding box [ymin, xmin, ymax, xmax] in 0-1000 page scale (TranslatedBubble.box convention). */
  box: number[];
}

export interface BackgroundArtworkConfirmation {
  /** Exact candidate id from a prior inspection of the same revisionKey. */
  candidateId: string;
  /** The inspection revisionKey this confirmation was recorded against. */
  revisionKey: string;
}

export interface BackgroundInspectionInput {
  revisions: BackgroundInspectionRevisions;
  originalPlane?: GrayscalePlane;
  cleanPlane?: GrayscalePlane;
  removalRegions?: readonly RemnantRemovalRegion[];
  textEvidence?: readonly RemnantTextEvidence[];
  /** Artwork confirmations from earlier inspections of the same revisionKey. */
  artworkConfirmations?: readonly BackgroundArtworkConfirmation[];
  options?: BackgroundInspectionOptions;
}

export interface BackgroundInspectionOptions {
  /** Luma distance from the local background that counts as ink (0-255). */
  inkThreshold?: number;
  /** Surviving-ink ratio at or above which a cleaned area counts as a full remnant. */
  fullRemnantRatio?: number;
  /** Surviving-ink ratio below which residue is treated as effectively removed. */
  removedRatio?: number;
  /** Mean horizontal surviving-ink run at or below which marks look line-like. */
  lineMeanRunMax?: number;
  /** Surviving-ink bounding-box coverage at or below which marks look line-like. */
  lineCoverageMax?: number;
  /** Upper bound on reported candidates; exceeding it marks the result truncated. */
  maxCandidates?: number;
}

export type RemnantCandidateState =
  | "suspected-remnant"
  | "unchanged-candidate"
  | "uncertain"
  | "human-confirmed-artwork";

export type RemnantCandidateDetail =
  | "full-glyph"
  | "partial-glyph"
  | "unchanged"
  | "line-like";

export interface RemnantCandidate {
  /** Deterministic for a given revisionKey + evidence geometry, so confirmations can bind. */
  id: string;
  state: RemnantCandidateState;
  detail: RemnantCandidateDetail;
  /** Page-pixel location of the surviving marks. */
  rect: PixelRect;
  /** Same location as [ymin, xmin, ymax, xmax] in 0-1000 page scale. */
  box: [number, number, number, number];
  /** Honest bounded score. Uncertain/line-like findings never exceed 0.35. */
  confidence: number;
  evidence: {
    removalRegionIds: string[];
    textEvidenceIds: string[];
    originalInkPixels: number;
    survivingInkPixels: number;
    meanLumaOriginal: number;
    meanLumaClean: number;
  };
  artworkConfirmation?: BackgroundArtworkConfirmation;
}

export type BackgroundInspectionUnverifiedReason =
  | "missing-revisions"
  | "missing-original"
  | "missing-clean"
  | "dimension-mismatch"
  | "detection-failed"
  | "no-removal-evidence";

export interface BackgroundInspectionResult {
  /** "inspected" only when detection actually ran over a non-empty bounded area. */
  status: "inspected" | "unverified";
  unverifiedReason?: BackgroundInspectionUnverifiedReason;
  unverifiedDetail?: string;
  revisionKey: string;
  revisions: BackgroundInspectionRevisions;
  /** All candidates, including human-confirmed artwork (kept visible, marked resolved). */
  candidates: RemnantCandidate[];
  inspectedAreas: number;
  /** True when maxCandidates hid further findings; the page stays unresolved. */
  truncated?: boolean;
}

const DEFAULTS = {
  inkThreshold: 48,
  fullRemnantRatio: 0.5,
  removedRatio: 0.12,
  lineMeanRunMax: 2.2,
  lineCoverageMax: 0.3,
  maxCandidates: 200,
} as const;

/** Smallest reviewable surviving mark, in pixels. */
const MIN_SURVIVING_ANY = 6;

export function revisionKeyOf(revisions: BackgroundInspectionRevisions): string | undefined {
  const { sourceRevision, backgroundRevision, removalRevision } = revisions;
  if (![sourceRevision, backgroundRevision, removalRevision].every(v => typeof v === "string" && v.length > 0)) {
    return undefined;
  }
  return JSON.stringify([`background-remnant-inspection-v${BACKGROUND_REMNANT_INSPECTION_VERSION}`, sourceRevision, backgroundRevision, removalRevision]);
}

/** ITU-R BT.601 luma with transparent pixels composited over white. */
export function lumaPlaneFromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayscalePlane {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 1) {
    const o = i * 4;
    const alpha = rgba[o + 3] ?? 255;
    const luma = 0.299 * (rgba[o] ?? 255) + 0.587 * (rgba[o + 1] ?? 255) + 0.114 * (rgba[o + 2] ?? 255);
    data[i] = Math.round(luma * (alpha / 255) + 255 * (1 - alpha / 255));
  }
  return { width, height, data };
}

function clampRect(rect: PixelRect, width: number, height: number): PixelRect | undefined {
  const x0 = Math.max(0, Math.min(width, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(height, Math.round(rect.y)));
  const x1 = Math.max(x0, Math.min(width, Math.round(rect.x + rect.width)));
  const y1 = Math.max(y0, Math.min(height, Math.round(rect.y + rect.height)));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return undefined;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function boxToRect(box: number[], width: number, height: number): PixelRect | undefined {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return undefined;
  const [ymin, xmin, ymax, xmax] = box;
  return clampRect({ x: (xmin / 1000) * width, y: (ymin / 1000) * height, width: ((xmax - xmin) / 1000) * width, height: ((ymax - ymin) / 1000) * height }, width, height);
}

function rectOverlapArea(a: PixelRect, b: PixelRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function normalizedBox(rect: PixelRect, width: number, height: number): [number, number, number, number] {
  return [
    Math.round((rect.y / height) * 1000),
    Math.round((rect.x / width) * 1000),
    Math.round(((rect.y + rect.height) / height) * 1000),
    Math.round(((rect.x + rect.width) / width) * 1000),
  ];
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

interface AreaStats {
  originalInk: number;
  surviving: number;
  survivingRatio: number;
  bbox: PixelRect | undefined;
  meanLumaOriginal: number;
  meanLumaClean: number;
  meanRun: number;
  coverage: number;
}

/**
 * Compare original and clean inside one evidence area. The background level is
 * estimated from a padded window of the ORIGINAL plane (75th percentile), so
 * areas that are entirely glyph ink still have a real background reference.
 */
function analyzeArea(original: GrayscalePlane, clean: GrayscalePlane, area: PixelRect, inkThreshold: number): AreaStats {
  const pad = Math.max(4, Math.round(Math.max(area.width, area.height) * 0.25));
  const extended = clampRect({ x: area.x - pad, y: area.y - pad, width: area.width + pad * 2, height: area.height + pad * 2 }, original.width, original.height) ?? area;
  const histogram = new Uint32Array(256);
  for (let y = extended.y; y < extended.y + extended.height; y += 1) {
    for (let x = extended.x; x < extended.x + extended.width; x += 1) {
      histogram[original.data[y * original.width + x]] += 1;
    }
  }
  let seen = 0;
  let background = 255;
  const needed = Math.ceil((extended.width * extended.height) * 0.75);
  for (let level = 0; level < 256; level += 1) {
    seen += histogram[level];
    if (seen >= needed) {
      background = level;
      break;
    }
  }
  const inkIsDark = background >= 128;
  const isInk = (luma: number) => (inkIsDark ? background - luma >= inkThreshold : luma - background >= inkThreshold);

  const oInk = new Uint8Array(area.width * area.height);
  const cInk = new Uint8Array(area.width * area.height);
  let originalInk = 0;
  let surviving = 0;
  let lumaOriginalSum = 0;
  let lumaCleanSum = 0;
  for (let y = 0; y < area.height; y += 1) {
    for (let x = 0; x < area.width; x += 1) {
      const o = area.y * original.width + area.x + y * original.width + x;
      const oi = y * area.width + x;
      const oLuma = original.data[o];
      const cLuma = clean.data[o];
      lumaOriginalSum += oLuma;
      lumaCleanSum += cLuma;
      if (isInk(oLuma)) {
        oInk[oi] = 1;
        originalInk += 1;
      }
      if (isInk(cLuma)) cInk[oi] = 1;
      if (oInk[oi] && cInk[oi]) surviving += 1;
    }
  }

  let minX = area.width;
  let minY = area.height;
  let maxX = -1;
  let maxY = -1;
  let runCount = 0;
  for (let y = 0; y < area.height; y += 1) {
    let runLength = 0;
    for (let x = 0; x < area.width; x += 1) {
      const both = oInk[y * area.width + x] && cInk[y * area.width + x];
      if (both) {
        runLength += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else if (runLength > 0) {
        runCount += 1;
        runLength = 0;
      }
    }
    if (runLength > 0) runCount += 1;
  }
  const bbox = maxX >= 0 ? { x: area.x + minX, y: area.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined;
  return {
    originalInk,
    surviving,
    survivingRatio: surviving / Math.max(1, originalInk),
    bbox,
    meanLumaOriginal: Math.round(lumaOriginalSum / Math.max(1, area.width * area.height)),
    meanLumaClean: Math.round(lumaCleanSum / Math.max(1, area.width * area.height)),
    meanRun: surviving / Math.max(1, runCount),
    coverage: bbox ? surviving / Math.max(1, bbox.width * bbox.height) : 0,
  };
}

function isLineLike(stats: AreaStats, options: Required<BackgroundInspectionOptions>): boolean {
  return stats.meanRun <= options.lineMeanRunMax && stats.coverage <= options.lineCoverageMax;
}

function unverifiedResult(revisions: BackgroundInspectionRevisions, revisionKey: string, reason: BackgroundInspectionUnverifiedReason, detail: string): BackgroundInspectionResult {
  return { status: "unverified", unverifiedReason: reason, unverifiedDetail: detail, revisionKey, revisions, candidates: [], inspectedAreas: 0 };
}

/**
 * Inspect one original/clean pair against existing text/removal evidence.
 * Synchronous, deterministic, allocation-bounded, and side-effect free.
 */
export function inspectBackgroundRemnants(input: BackgroundInspectionInput): BackgroundInspectionResult {
  const revisions = input.revisions;
  const revisionKey = revisionKeyOf(revisions) ?? "";
  if (!revisionKey) {
    return unverifiedResult(revisions, revisionKey, "missing-revisions", "Source, background and removal revision identities are required to bind findings.");
  }
  if (!input.originalPlane || !input.cleanPlane) {
    return unverifiedResult(revisions, revisionKey, input.originalPlane ? "missing-clean" : "missing-original", "Both the original and the clean background are required for remnant inspection.");
  }
  const removalRegions = input.removalRegions ?? [];
  const textEvidence = input.textEvidence ?? [];
  if (removalRegions.length === 0 && textEvidence.length === 0) {
    return unverifiedResult(revisions, revisionKey, "no-removal-evidence", "No removal regions or text evidence bound the search; the background cannot be verified.");
  }
  try {
    const raw = runDetection(input, revisions, revisionKey, removalRegions, textEvidence);
    return applyArtworkConfirmations(raw, input.artworkConfirmations ?? []);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return unverifiedResult(revisions, revisionKey, "detection-failed", detail);
  }
}

function runDetection(
  input: BackgroundInspectionInput,
  revisions: BackgroundInspectionRevisions,
  revisionKey: string,
  removalRegions: readonly RemnantRemovalRegion[],
  textEvidence: readonly RemnantTextEvidence[],
): BackgroundInspectionResult {
  const original = input.originalPlane as GrayscalePlane;
  const clean = input.cleanPlane as GrayscalePlane;
  if (original.width !== clean.width || original.height !== clean.height) {
    return unverifiedResult(revisions, revisionKey, "dimension-mismatch", `Original is ${original.width}x${original.height} but clean is ${clean.width}x${clean.height}.`);
  }
  if (original.data.length !== original.width * original.height || clean.data.length !== clean.width * clean.height) {
    throw new Error("Plane data length does not match its declared dimensions.");
  }
  const options: Required<BackgroundInspectionOptions> = { ...DEFAULTS, ...input.options };
  const { width, height } = original;

  const regionRects: PixelRect[] = [];
  for (const region of removalRegions) {
    const rect = clampRect(region.rect, width, height);
    if (rect) regionRects.push(rect);
  }

  const candidates: RemnantCandidate[] = [];
  let truncated = false;
  let inspectedAreas = 0;
  const addCandidate = (candidate: RemnantCandidate) => {
    if (candidates.length >= options.maxCandidates) {
      truncated = true;
      return;
    }
    candidates.push(candidate);
  };

  const makeCandidate = (
    state: RemnantCandidateState,
    detail: RemnantCandidateDetail,
    rect: PixelRect,
    confidence: number,
    evidence: RemnantCandidate["evidence"],
  ): RemnantCandidate => ({
    id: `rem-${fnv1a(`${revisionKey}|${state}|${detail}|${rect.x},${rect.y},${rect.width},${rect.height}`)}`,
    state,
    detail,
    rect,
    box: normalizedBox(rect, width, height),
    confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)),
    evidence,
  });

  const collectEvidence = (rect: PixelRect): RemnantCandidate["evidence"] => ({
    removalRegionIds: removalRegions.filter(r => {
      const rr = clampRect(r.rect, width, height);
      return rr && rectOverlapArea(rr, rect) > 0;
    }).map(r => r.id),
    textEvidenceIds: textEvidence.filter(t => {
      const tr = boxToRect(t.box, width, height);
      return tr && rectOverlapArea(tr, rect) > 0;
    }).map(t => t.id),
    originalInkPixels: 0,
    survivingInkPixels: 0,
    meanLumaOriginal: 0,
    meanLumaClean: 0,
  });

  // Pass 1: removal regions — areas where cleaning was attempted (or explicitly
  // preserved). Surviving ink here is a removal failure, not artwork to erase.
  for (const region of removalRegions) {
    const area = clampRect(region.rect, width, height);
    if (!area) continue;
    inspectedAreas += 1;
    // Explicitly preserved/protected marks were already reviewed; flagging them
    // again would spam review with decisions the user already made.
    if (region.status === "preserved" || region.textRole === "protected") continue;
    const stats = analyzeArea(original, clean, area, options.inkThreshold);
    if (stats.originalInk === 0 || stats.surviving < MIN_SURVIVING_ANY || stats.survivingRatio < options.removedRatio) continue;
    const base = collectEvidence(stats.bbox ?? area);
    base.originalInkPixels = stats.originalInk;
    base.survivingInkPixels = stats.surviving;
    base.meanLumaOriginal = stats.meanLumaOriginal;
    base.meanLumaClean = stats.meanLumaClean;
    if (isLineLike(stats, options)) {
      // Short thin runs with sparse coverage: hatching, hair or line art that
      // survived inside the region. Genuinely ambiguous — stays a low-confidence
      // review finding, never an auto-erase instruction.
      addCandidate(makeCandidate("uncertain", "line-like", stats.bbox ?? area, 0.3, base));
    } else if (stats.survivingRatio >= options.fullRemnantRatio) {
      addCandidate(makeCandidate("suspected-remnant", "full-glyph", stats.bbox ?? area, 0.55 + 0.4 * stats.survivingRatio, base));
    } else {
      addCandidate(makeCandidate("suspected-remnant", "partial-glyph", stats.bbox ?? area, 0.4 + 0.25 * stats.survivingRatio, base));
    }
  }

  // Pass 2: text evidence not explained by a removal region. Nothing here was
  // assumed cleaned, so findings are "unchanged candidates" for human review —
  // deliberately preserved text (inside preserved regions) is skipped.
  for (const evidence of textEvidence) {
    const area = boxToRect(evidence.box, width, height);
    if (!area) continue;
    inspectedAreas += 1;
    if (regionRects.some(rr => rectOverlapArea(rr, area) / Math.max(1, area.width * area.height) >= 0.3)) continue;
    const stats = analyzeArea(original, clean, area, options.inkThreshold);
    if (stats.originalInk === 0 || stats.surviving < MIN_SURVIVING_ANY || stats.survivingRatio < options.removedRatio) continue;
    const base = collectEvidence(stats.bbox ?? area);
    base.originalInkPixels = stats.originalInk;
    base.survivingInkPixels = stats.surviving;
    base.meanLumaOriginal = stats.meanLumaOriginal;
    base.meanLumaClean = stats.meanLumaClean;
    if (isLineLike(stats, options)) {
      addCandidate(makeCandidate("uncertain", "line-like", stats.bbox ?? area, 0.3, base));
    } else {
      const detail: RemnantCandidateDetail = stats.survivingRatio >= 0.8 ? "unchanged" : "partial-glyph";
      addCandidate(makeCandidate("unchanged-candidate", detail, stats.bbox ?? area, 0.6, base));
    }
  }

  // Artwork confirmations are applied by the caller-facing wrapper below, not
  // here, so cached raw results never bake a confirmation in.
  return { status: "inspected", revisionKey, revisions, candidates, inspectedAreas, ...(truncated ? { truncated: true } : {}) };
}

/**
 * Pure confirmation application. Confirmations only bind when their revisionKey
 * equals the inspected revisionKey; changed source/mask/background revisions
 * leave every candidate open again. Returns the same object when nothing binds.
 */
export function applyArtworkConfirmations(result: BackgroundInspectionResult, confirmations: readonly BackgroundArtworkConfirmation[]): BackgroundInspectionResult {
  if (confirmations.length === 0) return result;
  let changed = false;
  const candidates = result.candidates.map(candidate => {
    if (candidate.state === "human-confirmed-artwork") return candidate;
    const confirmation = confirmations.find(c => c.candidateId === candidate.id && c.revisionKey === result.revisionKey);
    if (!confirmation) return candidate;
    changed = true;
    return { ...candidate, state: "human-confirmed-artwork" as const, artworkConfirmation: confirmation };
  });
  return changed ? { ...result, candidates } : result;
}

/** Record that a specific candidate on a specific revision is artwork. Never future revisions. */
export function confirmCandidateArtwork(result: BackgroundInspectionResult, candidateId: string): BackgroundArtworkConfirmation | undefined {
  const candidate = result.candidates.find(c => c.id === candidateId);
  if (!candidate || candidate.state === "human-confirmed-artwork") return undefined;
  return { candidateId, revisionKey: result.revisionKey };
}

/**
 * Map an inspection outcome onto the shared page-output eligibility boundary
 * (lib/translation/pageEligibility.ts backgroundState input).
 */
export function backgroundEligibilityState(result: BackgroundInspectionResult): BackgroundEligibilityState {
  if (result.status === "unverified") return "unavailable";
  const open = result.candidates.some(c => c.state !== "human-confirmed-artwork");
  if (open || result.truncated) return "unresolved";
  return result.candidates.length > 0 ? "human-confirmed" : "approved";
}

/**
 * Bounded, revision-aware reuse of inspection results. Entries are keyed by the
 * exact revision identity, so any source/mask/background change misses the
 * cache and triggers a fresh inspection. Backed by an LRU map with a fixed
 * entry bound; results contain statistics only, never pixel buffers. Artwork
 * confirmations are applied per call on top of the cached raw result, so a
 * stored result can never carry a stale confirmation.
 */
export class BackgroundInspectionCache {
  private readonly entries: LRUMap<string, BackgroundInspectionResult>;

  constructor(maxEntries = 8) {
    this.entries = new LRUMap<BackgroundInspectionResult["revisionKey"], BackgroundInspectionResult>(Math.max(1, maxEntries));
  }

  inspect(input: BackgroundInspectionInput): BackgroundInspectionResult {
    const key = revisionKeyOf(input.revisions);
    let base = key ? this.entries.get(key) : undefined;
    if (!base) {
      base = inspectBackgroundRemnants({ ...input, artworkConfirmations: undefined });
      if (key && base.revisionKey === key) this.entries.set(key, base);
    }
    return applyArtworkConfirmations(base, input.artworkConfirmations ?? []);
  }

  invalidate(revisions: BackgroundInspectionRevisions): void {
    const key = revisionKeyOf(revisions);
    if (key) this.entries.delete(key);
  }
}
