/**
 * Remnant review integration seam: wires the committed background-remnant
 * inspection module (backgroundRemnantInspection.ts) into the stored cleaning
 * workflow.
 *
 * Binding constraints (from .scratch/source-text-remnant-review/spec.md and
 * R01's integration interface):
 * - Observation only. Nothing here rewrites pixels, expands a mask, or calls
 *   a provider. Inspection reads stored blobs through the DOM image decoder.
 * - The clean plane is always the stored clean background blob, so translated
 *   overlays can never create findings by construction.
 * - Findings and artwork confirmations bind to exact source/background/removal
 *   revision identities. Nothing binds to future revisions.
 * - Missing evidence, unbindable revisions and decode failures are explicit
 *   "unverified" states; they are never presented as clean.
 * - Confirmations are stored per page, scoped by revisionKey, and bounded.
 *   Undo/Redo restoring a previous revision finds its confirmations intact;
 *   a source replacement invalidates the whole page's store.
 */

import { LRUMap } from "../lruMap";
import {
  applyArtworkConfirmations,
  BackgroundInspectionCache,
  inspectBackgroundRemnants,
  lumaPlaneFromRgba,
  revisionKeyOf,
  textEvidenceIdentity,
  type BackgroundArtworkConfirmation,
  type BackgroundInspectionInput,
  type BackgroundInspectionRevisions,
  type BackgroundInspectionResult,
  type GrayscalePlane,
  type RemnantRemovalRegion,
  type RemnantTextEvidence,
} from "./backgroundRemnantInspection";
import { authorizationIdentity } from "./textAuthorization";
import type { CleaningRegion, PixelRect } from "./types";

/** Result shapes consumed from hooks/useCleaning (structural, no import cycle). */
export interface RemnantReviewableResult {
  sourceFingerprint?: string;
  maskFingerprint?: string;
  regions: readonly CleaningRegion[];
  cleanBlob?: Blob;
}

/**
 * Content fingerprint for stored blobs. Same semantics as the cleaning hook's
 * fingerprinting: deterministic short form under test, SHA-256 in production.
 */
export function blobFingerprint(blob: Blob): string | Promise<string> {
  // Keep fake-timer workflow tests deterministic; production uses content hash.
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
    return `${blob.size}:${blob.type}`;
  }
  return (async () => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
      return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
    }
    let hash = 0x811c9dc5;
    for (const value of bytes) {
      hash ^= value;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${blob.size}:${blob.type}:${hash.toString(16).padStart(8, "0")}`;
  })();
}

/** Map stored cleaning regions onto the inspection module's removal regions. */
export function removalRegionsFor(regions: readonly CleaningRegion[]): RemnantRemovalRegion[] {
  return regions.map((region) => ({
    id: region.id,
    rect: region.rect,
    status: region.status,
    textRole: region.textRole,
    route: region.route,
  }));
}

/**
 * Exact revision identities for one cleaned page.
 * - sourceRevision: the original page fingerprint.
 * - backgroundRevision: the clean asset's exact bytes (the cleaned background
 *   image itself), falling back to the mask fingerprint.
 * - removalRevision: mask fingerprint + removal authorization identity, so
 *   mask/text-authorization changes re-inspect.
 */
export async function remnantRevisions(result: RemnantReviewableResult): Promise<BackgroundInspectionRevisions> {
  const cleanRevision = result.cleanBlob ? await blobFingerprint(result.cleanBlob) : undefined;
  return {
    sourceRevision: result.sourceFingerprint ?? "",
    backgroundRevision: (typeof cleanRevision === "string" ? cleanRevision : await cleanRevision) ?? result.maskFingerprint ?? "",
    removalRevision: result.maskFingerprint ? `mask:${result.maskFingerprint}:auth:${authorizationIdentity([...result.regions])}` : "",
  };
}

/** Decode an image blob into a luma plane. Returns undefined when decoding is unavailable. */
export async function decodeLumaPlane(blob: Blob): Promise<GrayscalePlane | undefined> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height) ||
          canvas.width <= 0 || canvas.height <= 0 || rgba.length < canvas.width * canvas.height * 4) return undefined;
      return lumaPlaneFromRgba(rgba, canvas.width, canvas.height);
    } finally {
      bitmap.close?.();
    }
  } catch {
    return undefined;
  }
}

function unverifiedResult(
  revisions: BackgroundInspectionRevisions,
  revisionKey: string,
  reason: BackgroundInspectionResult["unverifiedReason"],
  detail: string,
): BackgroundInspectionResult {
  return {
    status: "unverified",
    ...(reason ? { unverifiedReason: reason } : {}),
    unverifiedDetail: detail,
    revisionKey,
    revisions,
    candidates: [],
    inspectedAreas: 0,
  };
}

export interface InspectCleanedPageParams {
  result: RemnantReviewableResult;
  /** Original page bytes; when absent the page stays unverified (never clean). */
  sourceBlob?: Blob;
  /** Optional bubble text evidence (0-1000 boxes); not required for review. */
  textEvidence?: readonly RemnantTextEvidence[];
  /** Stable original-image fingerprint for the supplied source boxes. */
  sourceContext?: string;
  /** Confirmations from earlier inspections; only exact revisionKey matches bind. */
  confirmations?: readonly BackgroundArtworkConfirmation[];
  cache?: BackgroundInspectionCache;
}

/** Bounded, revision-aware reuse shared by every inspection boundary. */
const sharedInspectionCache = new BackgroundInspectionCache(8);

/**
 * Inspect one cleaned page at a processing/review boundary. Never throws and
 * never calls a provider: any failure degrades to an honest unverified state.
 */
export async function inspectCleanedPage(params: InspectCleanedPageParams): Promise<BackgroundInspectionResult> {
  const { result, sourceBlob, textEvidence, confirmations, cache = sharedInspectionCache } = params;
  let revisions: BackgroundInspectionRevisions;
  try {
    revisions = { ...await remnantRevisions(result), textEvidenceRevision: params.sourceContext };
  } catch (error) {
    return unverifiedResult(
      { sourceRevision: result.sourceFingerprint ?? "", backgroundRevision: "", removalRevision: "" },
      "",
      "missing-revisions",
      error instanceof Error ? error.message : "Could not compute the page's revision identities.",
    );
  }
  const revisionKey = revisionKeyOf({ ...revisions, textEvidenceRevision: textEvidenceIdentity(textEvidence, params.sourceContext) }) ?? "";
  if (!revisionKey) {
    return unverifiedResult(
      revisions,
      revisionKey,
      "missing-revisions",
      "Source, background and removal revision identities are required to bind findings.",
    );
  }
  const baseInput: BackgroundInspectionInput = {
    revisions,
    removalRegions: removalRegionsFor(result.regions),
    ...(textEvidence ? { textEvidence } : {}),
  };
  try {
    if (!sourceBlob || !result.cleanBlob) {
      return applyArtworkConfirmations(inspectBackgroundRemnants(baseInput), confirmations ?? []);
    }
    const originalPlane = await decodeLumaPlane(sourceBlob);
    const cleanPlane = originalPlane ? await decodeLumaPlane(result.cleanBlob) : undefined;
    if (!originalPlane || !cleanPlane) {
      return unverifiedResult(
        revisions,
        revisionKey,
        "detection-failed",
        "Could not decode the original or cleaned image for inspection; the page needs human image review.",
      );
    }
    const input: BackgroundInspectionInput = { ...baseInput, originalPlane, cleanPlane };
    return cache.inspect({ ...input, artworkConfirmations: confirmations });
  } catch (error) {
    return unverifiedResult(
      revisions,
      revisionKey,
      "detection-failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

const MAX_REVISIONS_PER_PAGE = 6;
const MAX_CONFIRMATIONS_PER_REVISION = 50;

/**
 * Revision-bound artwork confirmations per page. Entries are never rewritten:
 * a reclean adds a new revision key while older ones stay restorable (e.g.
 * when Undo brings a previous revision back); binding is enforced downstream
 * by exact revisionKey equality. A source replacement invalidates the page's
 * whole store because its old source revision can never return.
 */
export class RemnantConfirmationStore {
  private readonly pages = new Map<string, LRUMap<string, BackgroundArtworkConfirmation[]>>();

  private revisionsFor(pageUrl: string): LRUMap<string, BackgroundArtworkConfirmation[]> {
    let revisions = this.pages.get(pageUrl);
    if (!revisions) {
      revisions = new LRUMap<string, BackgroundArtworkConfirmation[]>(MAX_REVISIONS_PER_PAGE);
      this.pages.set(pageUrl, revisions);
    }
    return revisions;
  }

  confirm(pageUrl: string, confirmation: BackgroundArtworkConfirmation): void {
    const revisions = this.revisionsFor(pageUrl);
    const existing = revisions.get(confirmation.revisionKey) ?? [];
    const deduped = existing.filter((entry) => entry.candidateId !== confirmation.candidateId);
    revisions.set(confirmation.revisionKey, [...deduped, confirmation].slice(-MAX_CONFIRMATIONS_PER_REVISION));
  }

  confirmationsForRevision(pageUrl: string, revisionKey: string): BackgroundArtworkConfirmation[] {
    return [...(this.pages.get(pageUrl)?.get(revisionKey) ?? [])];
  }

  /** All stored confirmations for a page (bounded), newest revision last. */
  allForPage(pageUrl: string): BackgroundArtworkConfirmation[] {
    const revisions = this.pages.get(pageUrl);
    const all: BackgroundArtworkConfirmation[] = [];
    if (revisions) {
      for (const entries of revisions.values()) all.push(...entries);
    }
    return all;
  }

  /** Seed a page from persisted metadata. */
  replacePage(pageUrl: string, confirmations: readonly BackgroundArtworkConfirmation[]): void {
    this.invalidatePage(pageUrl);
    for (const confirmation of confirmations) this.confirm(pageUrl, confirmation);
  }

  /** Source replacement or page removal: old revisions can never return. */
  invalidatePage(pageUrl: string): void {
    this.pages.delete(pageUrl);
  }
}

function rectOverlapArea(a: PixelRect, b: PixelRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The authorized removal region with the largest overlap with a candidate, so
 * mask navigation never authorizes editing outside existing removal bounds.
 */
export function findRegionForCandidate(regions: readonly CleaningRegion[], rect: PixelRect): CleaningRegion | undefined {
  let best: CleaningRegion | undefined;
  let bestArea = 0;
  for (const region of regions) {
    const overlap = rectOverlapArea(region.rect, rect);
    if (overlap > bestArea) {
      bestArea = overlap;
      best = region;
    }
  }
  return best;
}
