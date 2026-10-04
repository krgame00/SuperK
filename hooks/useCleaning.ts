"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CleaningClientError,
  createCleaningJob,
  getCleaningJob,
  getCleaningResult,
  retryCleaningRegion,
} from "@/lib/cleaning/client";
import type {
  CleanerOverride,
  CleaningJob,
  CleaningProgress,
  CleaningResult,
  CleaningRegion,
  ManualRegionAction,
  CleaningMode,
} from "@/lib/cleaning/types";
import {
  loadCleaningResultAssets,
  loadCleaningResultsMetadata,
  saveCleaningAssets,
  saveCleaningResultMetadata,
} from "@/lib/projectStore";
import { assertMatchingImageDimensions } from "@/lib/translationPipeline";
import { authorizationIdentity } from "@/lib/cleaning/textAuthorization";
import {
  applyArtworkConfirmations,
  backgroundEligibilityState,
  confirmCandidateArtwork,
  textEvidenceIdentity,
  type RemnantTextEvidence,
  type BackgroundInspectionResult,
} from "@/lib/cleaning/backgroundRemnantInspection";
import {
  blobFingerprint,
  inspectCleanedPage,
  RemnantConfirmationStore,
} from "@/lib/cleaning/remnantReview";
import type { BackgroundEligibilityState } from "@/lib/translation/pageEligibility";

const POLL_INTERVAL_MS = 500;
const CURRENT_PIPELINE_VERSION = "2.3.1-enclosed-backing";

const fingerprintBlob = blobFingerprint;

const buildPreparedIdentity = (
  sourceFingerprint: string,
  maskFingerprint: string,
  pipelineVersion?: string,
  regions: CleaningResult["regions"] = [],
  cleaningMode: CleaningMode = "safe",
) => `${sourceFingerprint}:${maskFingerprint}:${pipelineVersion ?? "unknown-pipeline"}:${authorizationIdentity(regions)}:${cleaningMode}`;

const safeRestoredRegions = (regions: CleaningResult["regions"]): CleaningResult["regions"] =>
  regions.map((region) => region.maskApproved && !region.approvalRevision
    ? { ...region, maskApproved: false, approvalRevision: null }
    : region);

const regionAliasKey = (pageUrl: string, regionId: string) =>
  `${pageUrl}\u0000${regionId}`;

async function intersectMaskWithRegion(mask: Blob, rect: CleaningResult["regions"][number]["rect"]): Promise<Blob> {
  const bitmap = await createImageBitmap(mask);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot inspect the recovered Mask.");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) continue;
        const index = (y * canvas.width + x) * 4;
        pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = 0;
      }
    }
    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Cannot save the recovered Mask.")), "image/png"),
    );
  } finally {
    bitmap.close();
  }
}

export function findRecoveredRegionId(
  previousRegion: CleaningResult["regions"][number] | undefined,
  refreshed: CleaningResult["regions"],
  preferredId: string,
): string | undefined {
  if (refreshed.some((region) => region.id === preferredId)) return preferredId;
  if (!previousRegion) return undefined;

  const previous = previousRegion.rect;
  const previousArea = Math.max(1, previous.width * previous.height);
  let bestId: string | undefined;
  let bestScore = 0;
  let runnerUp = 0;

  for (const region of refreshed) {
    const rect = region.rect;
    const left = Math.max(previous.x, rect.x);
    const top = Math.max(previous.y, rect.y);
    const right = Math.min(previous.x + previous.width, rect.x + rect.width);
    const bottom = Math.min(previous.y + previous.height, rect.y + rect.height);
    const intersection =
      Math.max(0, right - left) * Math.max(0, bottom - top);
    const area = Math.max(1, rect.width * rect.height);
    const union = previousArea + area - intersection;
    const score = union > 0 ? intersection / union : 0;
    const centerDistance = Math.hypot(
      previous.x + previous.width / 2 - rect.x - rect.width / 2,
      previous.y + previous.height / 2 - rect.y - rect.height / 2,
    );
    const centerLimit = Math.min(previous.width, previous.height) / 4;
    if (score < 0.5 || centerDistance > centerLimit) continue;
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      bestId = region.id;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  return bestScore - runnerUp > 0.05 ? bestId : undefined;
}

export interface PageCleaningResult extends CleaningResult {
  maskAdjustment?: "remapped";
  recoveredRegionId?: string;
  cleanUrl: string;
  maskUrl: string;
  reviewMaskUrl: string;
  protectedMaskUrl: string;
  sourceFingerprint?: string;
  /** Missing on legacy/restored results; such entries are never reused. */
  maskFingerprint?: string;
  preparedIdentity?: string;
  cleanBlob?: Blob;
  maskBlob?: Blob;
  reviewMaskBlob?: Blob;
  protectedMaskBlob?: Blob;
}

/** One page's background-remnant review evidence, bound to exact revisions. */
export interface PageRemnantReview {
  pageUrl: string;
  inspection: BackgroundInspectionResult;
  /** Shared output-eligibility input: never "approved" while unverified. */
  eligibility: BackgroundEligibilityState;
}
export interface PageRemnantTextEvidence {
  sourceContext: string;
  textEvidence: readonly RemnantTextEvidence[];
}
export interface CleaningHookError {
  message: string;
  recovery: "retry" | "start-local-service" | "reclean";
}
interface UseCleaningInput {
  pages: string[];
  pageIds?: (string | undefined)[];
  currentPage: number;
}
class PollingCancelled extends Error {}

export function useCleaning({ pages, pageIds, currentPage }: UseCleaningInput) {
  const [resultsByPage, setResultsByPage] = useState<
    Map<string, PageCleaningResult>
  >(new Map());
  /** increments whenever results change; lets consumers read resultsRef reactively */
  const [cacheRevision, setCacheRevision] = useState(0);
  const [progressState, setProgressState] = useState<{
    pageUrl: string;
    value: CleaningProgress;
  }>();
  const [error, setError] = useState<CleaningHookError>();
  const [remnantReviews, setRemnantReviews] = useState<Map<string, PageRemnantReview>>(new Map());
  const pageTokensRef = useRef<Map<string, number>>(new Map());
  const remnantReviewsRef = useRef(remnantReviews);
  const textEvidenceRef = useRef(new Map<string, PageRemnantTextEvidence>());
  const reviewBindingsRef = useRef(new Map<string, {
    result: PageCleaningResult; cleanBlob?: Blob; maskBlob?: Blob;
    sourceFingerprint?: string; maskFingerprint?: string; authorization: string; evidenceIdentity: string;
  }>());
  const confirmationsRef = useRef(new RemnantConfirmationStore());
  const inspectionTokensRef = useRef<Map<string, number>>(new Map());
  const lastSourceRevisionRef = useRef<Map<string, string>>(new Map());
  const currentPageUrl = pages[currentPage];
  const pageUrlRef = useRef(currentPageUrl);
  const pagesRef = useRef(pages);
  const pageIdsRef = useRef(pageIds);
  pageIdsRef.current = pageIds;
  const resultsRef = useRef(resultsByPage);
  const restoreStartedRef = useRef(false);
  const regionAliasRef = useRef<Map<string, string>>(new Map());
  const cancelOnPageChangeRef = useRef(false);
  const activeRequestRef = useRef<
    { token: number; pageUrl: string } | undefined
  >(undefined);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    resultsRef.current = resultsByPage;
  }, [resultsByPage]);

  const cancelPolling = useCallback(() => {
    for (const [url, t] of pageTokensRef.current.entries()) {
      pageTokensRef.current.set(url, t + 1);
    }
    setProgressState(undefined);
  }, []);

  useEffect(() => {
    const pageChanged = pageUrlRef.current !== currentPageUrl;
    const oldUrl = pageUrlRef.current;
    pageUrlRef.current = currentPageUrl;
    const activeRequest = activeRequestRef.current;
    if (
      activeRequest &&
      (!pagesRef.current.includes(activeRequest.pageUrl) ||
        (cancelOnPageChangeRef.current && pageChanged))
    ) {
      if (oldUrl) {
        pageTokensRef.current.set(oldUrl, (pageTokensRef.current.get(oldUrl) ?? 0) + 1);
      }
      setProgressState((previous) =>
        previous?.pageUrl === activeRequest.pageUrl ? undefined : previous,
      );
    }
  }, [currentPageUrl, pages]);

  const revokeResult = useCallback((result: PageCleaningResult) => {
    URL.revokeObjectURL(result.cleanUrl);
    URL.revokeObjectURL(result.maskUrl);
    URL.revokeObjectURL(result.reviewMaskUrl);
    URL.revokeObjectURL(result.protectedMaskUrl);
  }, []);

  const replaceResult = useCallback(
    (pageUrl: string, next: PageCleaningResult) => {
      const old = resultsRef.current.get(pageUrl);
      if (old) revokeResult(old);
      const updated = new Map(resultsRef.current);
      updated.set(pageUrl, next);
      resultsRef.current = updated;
      reviewBindingsRef.current.delete(pageUrl);
      const reviews = new Map(remnantReviewsRef.current);
      reviews.delete(pageUrl);
      remnantReviewsRef.current = reviews;
      setRemnantReviews(reviews);
      setResultsByPage(updated);
      setCacheRevision((revision) => revision + 1);
    },
    [revokeResult],
  );

  const publishRemnantReview = useCallback(
    (pageUrl: string, inspection: BackgroundInspectionResult) => {
      const updated = new Map(remnantReviewsRef.current);
      updated.set(pageUrl, { pageUrl, inspection, eligibility: backgroundEligibilityState(inspection) });
      remnantReviewsRef.current = updated;
      setRemnantReviews(updated);
    },
    [],
  );

  const getCurrentRemnantReview = useCallback((pageUrl: string, expectedEvidence?: PageRemnantTextEvidence): PageRemnantReview | undefined => {
    const result = resultsRef.current.get(pageUrl);
    const binding = reviewBindingsRef.current.get(pageUrl);
    const evidence = textEvidenceRef.current.get(pageUrl);
    const identity = textEvidenceIdentity(evidence?.textEvidence, evidence?.sourceContext);
    if (expectedEvidence && (!expectedEvidence.sourceContext || !evidence ||
        textEvidenceIdentity(expectedEvidence.textEvidence, expectedEvidence.sourceContext) !== identity)) return undefined;
    if (!result || !binding || result !== binding.result ||
        binding.evidenceIdentity !== identity || (evidence && evidence.sourceContext !== result.sourceFingerprint) ||
        result.cleanBlob !== binding.cleanBlob || result.maskBlob !== binding.maskBlob ||
        result.sourceFingerprint !== binding.sourceFingerprint || result.maskFingerprint !== binding.maskFingerprint ||
        authorizationIdentity(result.regions) !== binding.authorization) return undefined;
    return remnantReviewsRef.current.get(pageUrl);
  }, []);

  /**
   * Inspect one page's clean background against its original at a processing
   * boundary. Provider-free and read-only: a failed or unavailable inspection
   * publishes an unverified state, never a clean one. Findings and artwork
   * confirmations bind to the exact source/background/removal revisions, so
   * recleaning, mask edits, source replacement and Undo/Redo naturally
   * invalidate or restore exactly the revision-bound review state.
   */
  const inspectPageRemnants = useCallback(
    async (pageUrl: string, result: PageCleaningResult, sourceBlob?: Blob) => {
      const evidence = textEvidenceRef.current.get(pageUrl);
      const token = (inspectionTokensRef.current.get(pageUrl) ?? 0) + 1;
      inspectionTokensRef.current.set(pageUrl, token);
      reviewBindingsRef.current.delete(pageUrl);
      const pendingReviews = new Map(remnantReviewsRef.current);
      pendingReviews.delete(pageUrl);
      remnantReviewsRef.current = pendingReviews;
      setRemnantReviews(pendingReviews);
      const binding = {
        result, cleanBlob: result.cleanBlob, maskBlob: result.maskBlob,
        sourceFingerprint: result.sourceFingerprint, maskFingerprint: result.maskFingerprint,
        authorization: authorizationIdentity(result.regions),
        evidenceIdentity: textEvidenceIdentity(evidence?.textEvidence, evidence?.sourceContext),
      };
      const inspectionResult = { ...result, regions: result.regions.map(region => ({ ...region, rect: { ...region.rect } })) };
      let original = sourceBlob;
      if (!original) {
        try {
          const response = await fetch(pageUrl, { cache: "no-store" });
          original = response.ok ? await response.blob() : undefined;
        } catch {
          original = undefined;
        }
      }
      // Source replacement: old confirmations could never bind the new source.
      const sourceRevision = result.sourceFingerprint ?? "";
      // A URL can keep its identity while its bytes change. Never inspect new
      // original pixels under the old saved source revision or cached approval.
      if (original && await fingerprintBlob(original) !== sourceRevision) {
        confirmationsRef.current.invalidatePage(pageUrl);
        original = undefined;
      }
      const previousSource = lastSourceRevisionRef.current.get(pageUrl);
      if (previousSource && sourceRevision && previousSource !== sourceRevision) {
        confirmationsRef.current.invalidatePage(pageUrl);
      }
      if (sourceRevision) lastSourceRevisionRef.current.set(pageUrl, sourceRevision);
      const inspection = await inspectCleanedPage({
        result: inspectionResult,
        ...(original && (!evidence || evidence.sourceContext === result.sourceFingerprint) ? { sourceBlob: original } : {}),
        textEvidence: evidence?.textEvidence,
        sourceContext: evidence?.sourceContext,
        confirmations: confirmationsRef.current.allForPage(pageUrl),
      });
      // A newer result superseded this run; it schedules its own inspection.
      if (inspectionTokensRef.current.get(pageUrl) !== token || resultsRef.current.get(pageUrl) !== result ||
          textEvidenceIdentity(textEvidenceRef.current.get(pageUrl)?.textEvidence, textEvidenceRef.current.get(pageUrl)?.sourceContext) !== binding.evidenceIdentity ||
          result.cleanBlob !== binding.cleanBlob || result.maskBlob !== binding.maskBlob ||
          result.sourceFingerprint !== binding.sourceFingerprint || result.maskFingerprint !== binding.maskFingerprint ||
          authorizationIdentity(result.regions) !== binding.authorization) return;
      reviewBindingsRef.current.set(pageUrl, binding);
      publishRemnantReview(pageUrl, inspection);
    },
    [publishRemnantReview],
  );

  const setPageRemnantTextEvidence = useCallback((pageUrl: string, evidence?: PageRemnantTextEvidence) => {
    const previous = textEvidenceRef.current.get(pageUrl);
    if (textEvidenceIdentity(previous?.textEvidence, previous?.sourceContext) === textEvidenceIdentity(evidence?.textEvidence, evidence?.sourceContext)) return;
    if (evidence) textEvidenceRef.current.set(pageUrl, { sourceContext: evidence.sourceContext, textEvidence: evidence.textEvidence.map(e => ({ id: e.id, box: [...e.box] })) });
    else textEvidenceRef.current.delete(pageUrl);
    inspectionTokensRef.current.set(pageUrl, (inspectionTokensRef.current.get(pageUrl) ?? 0) + 1);
    reviewBindingsRef.current.delete(pageUrl);
    const reviews = new Map(remnantReviewsRef.current);
    reviews.delete(pageUrl);
    remnantReviewsRef.current = reviews;
    setRemnantReviews(reviews);
    queueMicrotask(() => {
      const result = resultsRef.current.get(pageUrl);
      if (result && pagesRef.current.includes(pageUrl)) void inspectPageRemnants(pageUrl, result);
    });
  }, [inspectPageRemnants]);

  const persistArtworkConfirmations = useCallback(
    async (pageUrl: string) => {
      try {
        const saved = await loadCleaningResultsMetadata();
        const record = saved.get(pageUrl);
        if (!record) return;
        await saveCleaningResultMetadata({
          ...record,
          artworkConfirmations: confirmationsRef.current.allForPage(pageUrl),
          updatedAt: Date.now(),
        });
      } catch (error) {
        console.warn("Failed to persist artwork confirmations:", error);
      }
    },
    [],
  );

  /**
   * Explicitly confirm one candidate of the current inspection as artwork.
   * Scoped to that exact candidate id and inspection revisionKey — never a
   * broad or future approval. Unverified pages cannot be confirmed away.
   */
  const confirmArtworkCandidate = useCallback(
    (pageUrl: string, candidateId: string): boolean => {
      const review = getCurrentRemnantReview(pageUrl);
      if (!review || review.inspection.status !== "inspected") return false;
      const confirmation = confirmCandidateArtwork(review.inspection, candidateId);
      if (!confirmation) return false;
      confirmationsRef.current.confirm(pageUrl, confirmation);
      publishRemnantReview(pageUrl, applyArtworkConfirmations(review.inspection, [confirmation]));
      void persistArtworkConfirmations(pageUrl);
      return true;
    },
    [getCurrentRemnantReview, persistArtworkConfirmations, publishRemnantReview],
  );

  const hydrateResult = useCallback(
    async (result: CleaningResult, signal?: AbortSignal): Promise<PageCleaningResult> => {
      const responses = await Promise.all([
        fetch(result.cleanAsset, { cache: "no-store", ...(signal ? {signal} : {}) }),
        fetch(result.maskAsset, { cache: "no-store", ...(signal ? {signal} : {}) }),
        fetch(result.reviewMaskAsset, { cache: "no-store", ...(signal ? {signal} : {}) }),
        fetch(result.protectedMaskAsset, { cache: "no-store", ...(signal ? {signal} : {}) }),
      ]);
      if (responses.some((response) => !response.ok)) {
        throw new CleaningClientError(
          Math.max(...responses.map((response) => response.status)),
          "Saved cleaning assets are unavailable.",
          "Clean this page again.",
        );
      }
      const [cleanBlob, maskBlob, reviewBlob, protectedBlob] =
        await Promise.all(
          responses.map((response) => response.blob()),
        );
      if (
        cleanBlob.size === 0 ||
        maskBlob.size === 0 ||
        reviewBlob.size === 0 ||
        protectedBlob.size === 0
      ) {
        throw new CleaningClientError(
          500,
          "Saved cleaning assets are empty.",
          "Clean this page again.",
        );
      }
      const maskFingerprint = await fingerprintBlob(maskBlob);
      const bitmap = await createImageBitmap(cleanBlob);
      try {
        assertMatchingImageDimensions(
          { width: result.width, height: result.height },
          { width: bitmap.width, height: bitmap.height },
        );
      } finally {
        bitmap.close();
      }
      return {
        ...result,
        cleanUrl: URL.createObjectURL(cleanBlob),
        maskUrl: URL.createObjectURL(maskBlob),
        reviewMaskUrl: URL.createObjectURL(reviewBlob),
        protectedMaskUrl: URL.createObjectURL(protectedBlob),
        cleanBlob,
        maskBlob,
        reviewMaskBlob: reviewBlob,
        protectedMaskBlob: protectedBlob,
        maskFingerprint,
      };
    },
    [],
  );

  const waitForJob = useCallback(
    async (
      initial: CleaningJob,
      token: number,
      pageUrl: string,
      signal?: AbortSignal,
    ): Promise<CleaningJob> => {
      let job = initial;
      while (job.status === "queued" || job.status === "running") {
        await delay(POLL_INTERVAL_MS);
        if (signal?.aborted) throw new DOMException("Cleaning cancelled", "AbortError");
        if (
          token !== pageTokensRef.current.get(pageUrl) ||
          !pagesRef.current.includes(pageUrl)
        ) {
          throw new PollingCancelled();
        }
        job = signal ? await getCleaningJob(job.jobId,signal) : await getCleaningJob(job.jobId);
        if (job.progress) setProgressState({ pageUrl, value: job.progress });
      }
      if (job.status === "failed") {
        throw new CleaningClientError(
          500,
          job.error || "Image cleaning failed.",
          "Retry cleaning this page.",
        );
      }
      return job;
    },
    [],
  );

  const finishJob = useCallback(
    async (
      job: CleaningJob,
      token: number,
      pageUrl: string,
      sourceFingerprint?: string,
      signal?: AbortSignal,
      sourceBlob?: Blob,
    ): Promise<PageCleaningResult> => {
      if (signal?.aborted) throw new DOMException("Cleaning cancelled", "AbortError");
      const result = signal ? await getCleaningResult(job.jobId,signal) : await getCleaningResult(job.jobId);
      const hydrated = await hydrateResult(result,signal);
      if (signal?.aborted) {
        revokeResult(hydrated);
        throw new DOMException("Cleaning cancelled", "AbortError");
      }
      if (
        token !== pageTokensRef.current.get(pageUrl) ||
        !pagesRef.current.includes(pageUrl)
      ) {
        revokeResult(hydrated);
        throw new PollingCancelled();
      }
      const identified: PageCleaningResult = {
        ...hydrated,
        sourceFingerprint,
        preparedIdentity: sourceFingerprint
          ? buildPreparedIdentity(
              sourceFingerprint,
              hydrated.maskFingerprint ?? "unknown-mask",
              hydrated.pipelineVersion,
              hydrated.regions,
              hydrated.cleaningMode,
            )
          : undefined,
      };
      replaceResult(pageUrl, identified);
      // Inspect the fresh clean background (without translated overlays) at
      // this processing boundary; findings bind to the exact revisions above.
      await inspectPageRemnants(pageUrl, identified, sourceBlob);
      try {
        let assetIds: {
          cleanAssetId?: string;
          maskAssetId?: string;
          reviewMaskAssetId?: string;
          protectedMaskAssetId?: string;
        } = {};
        if (identified.cleanBlob) {
          assetIds = await saveCleaningAssets(pageUrl, {
            cleanBlob: identified.cleanBlob,
            maskBlob: identified.maskBlob,
            reviewMaskBlob: identified.reviewMaskBlob,
            protectedMaskBlob: identified.protectedMaskBlob,
          }, pageIdsRef.current?.[pagesRef.current.indexOf(pageUrl)]);
        }
        await saveCleaningResultMetadata({
          pageUrl,
          sourceHash: result.sourceHash,
          sourceFingerprint,
          maskFingerprint: identified.maskFingerprint,
          pipelineVersion: result.pipelineVersion,
          revision: token,
          jobId: result.jobId,
          regions: result.regions,
          updatedAt: Date.now(),
          width: result.width,
          height: result.height,
          timingsMs: result.timingsMs,
          awaitingReview: result.awaitingReview,
          cleaningMode: result.cleaningMode ?? "safe",
          artworkConfirmations: confirmationsRef.current.allForPage(pageUrl),
          ...assetIds,
        });
      } catch (saveErr) {
        console.warn("Failed to persist cleaning result metadata:", saveErr);
      } finally {
        setProgressState((previous) => (previous?.pageUrl === pageUrl ? undefined : previous));
      }
      return identified;
    },
    [hydrateResult, inspectPageRemnants, replaceResult, revokeResult],
  );

  const runJob = useCallback(
    async (
      initial: CleaningJob,
      token: number,
      pageUrl: string,
      sourceFingerprint?: string,
      signal?: AbortSignal,
      sourceBlob?: Blob,
    ): Promise<PageCleaningResult> => {
      try {
        const terminal = await waitForJob(initial, token, pageUrl,signal);
        return await finishJob(terminal, token, pageUrl, sourceFingerprint,signal, sourceBlob);
      } finally {
        setProgressState((previous) => (previous?.pageUrl === pageUrl ? undefined : previous));
      }
    },
    [finishJob, waitForJob],
  );

  const handleFailure = useCallback((caught: unknown, pageUrl?: string) => {
    if (pageUrl) {
      setProgressState((previous) => (previous?.pageUrl === pageUrl ? undefined : previous));
    }
    if (caught instanceof PollingCancelled || (caught && typeof caught === "object" && "name" in caught && caught.name === "AbortError")) return;
    if (caught instanceof CleaningClientError && caught.status === 503) {
      setError({ message: caught.message, recovery: "start-local-service" });
      return;
    }
    if (caught instanceof CleaningClientError && caught.status === 404) {
      setError({
        message: "งานคลีนเดิมหมดอายุหลังรีสตาร์ตระบบ กรุณาคลีนหน้านี้ใหม่แล้วลอง Mask อีกครั้ง",
        recovery: "reclean",
      });
      return;
    }
    setError({
      message:
        caught instanceof Error ? caught.message : "Image cleaning failed.",
      recovery: "retry",
    });
  }, []);

  const cleanPage = useCallback(
    async (
      pageUrl: string,
      source: Blob,
      force: boolean = false,
      signal?: AbortSignal,
    ): Promise<PageCleaningResult> => {
      if (signal?.aborted) throw new DOMException("Cleaning cancelled", "AbortError");
      setError(undefined);
      const sourceFingerprintValue = fingerprintBlob(source);
      const cached = !force ? resultsRef.current.get(pageUrl) : undefined;
      if (!force) {
        const sourceFingerprint =
          typeof sourceFingerprintValue === "string"
            ? sourceFingerprintValue
            : await sourceFingerprintValue;
        if (signal?.aborted) throw new DOMException("Cleaning cancelled", "AbortError");
        if (
          cached &&
          cached.sourceFingerprint &&
          cached.maskFingerprint &&
          cached.cleaningMode === "all-text" &&
          cached.sourceFingerprint === sourceFingerprint &&
          cached.pipelineVersion === CURRENT_PIPELINE_VERSION
        ) {
          return cached;
        }
      }
      const token = (pageTokensRef.current.get(pageUrl) ?? 0) + 1;
      pageTokensRef.current.set(pageUrl, token);
      activeRequestRef.current = { token, pageUrl };
      const cancelRequest = () => {
        if (pageTokensRef.current.get(pageUrl) === token) pageTokensRef.current.set(pageUrl,token+1);
      };
      signal?.addEventListener("abort",cancelRequest,{once:true});
      try {
        // Start the request before hashing the first uncached page so source
        // fingerprinting cannot delay the polling schedule.
        const jobPromise = signal ? createCleaningJob(source,signal) : createCleaningJob(source);
        const sourceFingerprint =
          typeof sourceFingerprintValue === "string"
            ? sourceFingerprintValue
            : await sourceFingerprintValue;
        const job = await jobPromise;
        if (signal?.aborted) throw new DOMException("Cleaning cancelled", "AbortError");
        return await runJob(job, token, pageUrl, sourceFingerprint,signal, source);
      } catch (caught) {
        handleFailure(caught, pageUrl);
        throw caught;
      } finally {
        signal?.removeEventListener("abort",cancelRequest);
        setProgressState((previous) => (previous?.pageUrl === pageUrl ? undefined : previous));
        if (activeRequestRef.current?.token === token && activeRequestRef.current?.pageUrl === pageUrl) {
          activeRequestRef.current = undefined;
        }
      }
    },
    [handleFailure, runJob],
  );

  const cleanCurrentPage = useCallback(
    async (
      source: Blob,
      force: boolean = true,
    ): Promise<PageCleaningResult | undefined> => {
      const pageUrl = pageUrlRef.current;
      if (!pageUrl) return undefined;
      cancelOnPageChangeRef.current = true;
      try {
        return await cleanPage(pageUrl, source, force);
      } catch {
        // CleaningToolbar renders the structured hook error.
        return undefined;
      } finally {
        cancelOnPageChangeRef.current = false;
      }
    },
    [cleanPage],
  );

  const resolveMaskRegion = useCallback(async (region: CleaningRegion): Promise<{
    region: CleaningRegion;
    proposalMaskUrl: string;
    remapped: boolean;
  } | undefined> => {
    const pageUrl = pageUrlRef.current;
    const current = pageUrl ? resultsRef.current.get(pageUrl) : undefined;
    if (!pageUrl || !current) return undefined;
    const aliasedId = regionAliasRef.current.get(regionAliasKey(pageUrl, region.id)) ?? region.id;
    try {
      await getCleaningJob(current.jobId);
      const selected = current.regions.find((item) => item.id === aliasedId);
      return selected ? { region: selected, proposalMaskUrl: current.reviewMaskUrl, remapped: aliasedId !== region.id } : undefined;
    } catch (error) {
      if (!(error instanceof CleaningClientError) || error.status !== 404) throw error;
      const response = await fetch(pageUrl, { cache: "no-store" });
      if (!response.ok) throw error;
      const refreshed = await cleanPage(pageUrl, await response.blob(), true);
      const recoveredId = findRecoveredRegionId(region, refreshed.regions, aliasedId);
      const recovered = refreshed.regions.find((item) => item.id === recoveredId);
      if (!recovered) throw new Error("ไม่พบพื้นที่ Mask ที่ตรงกันอย่างปลอดภัย กรุณาตรวจและเลือกพื้นที่ใหม่");
      const remapped = recovered.id !== region.id ||
        JSON.stringify(recovered.rect) !== JSON.stringify(region.rect);
      if (remapped) regionAliasRef.current.set(regionAliasKey(pageUrl, region.id), recovered.id);
      return { region: recovered, proposalMaskUrl: refreshed.reviewMaskUrl, remapped };
    }
  }, [cleanPage]);

  const retryRegion = useCallback(
    async (
      regionId: string,
      mask: Blob,
      cleaner: CleanerOverride = "auto",
      action: ManualRegionAction = "automatic",
    ): Promise<PageCleaningResult | undefined> => {
      const pageUrl = pageUrlRef.current;
      let current = pageUrl
        ? resultsRef.current.get(pageUrl)
        : undefined;
      if (!pageUrl || !current) return;

      const originalRegionId = regionId;
      const aliasKey = regionAliasKey(pageUrl, regionId);
      let resolvedRegionId =
        regionAliasRef.current.get(aliasKey) ?? regionId;
      let previousRegion = current.regions.find(
        (region) => region.id === resolvedRegionId || region.id === originalRegionId,
      );
      let remapped = false;
      let token = (pageTokensRef.current.get(pageUrl) ?? 0) + 1;
      pageTokensRef.current.set(pageUrl, token);
      activeRequestRef.current = { token, pageUrl };
      cancelOnPageChangeRef.current = true;
      setError(undefined);

      try {
        // A previous 404 may already have established an alias. Subsequent
        // actions can still carry the editor's original mask.
        const maskForCurrentRegion = regionAliasRef.current.has(aliasKey) && previousRegion
          ? await intersectMaskWithRegion(mask, previousRegion.rect)
          : mask;
        let job;
        try {
          job = await retryCleaningRegion(
            current.jobId,
            resolvedRegionId,
            maskForCurrentRegion,
            cleaner,
            action,
          );
        } catch (caught) {
          if (!(caught instanceof CleaningClientError) || caught.status !== 404) {
            throw caught;
          }

          // The browser can restore a persisted clean result after the local
          // Python cleaner has restarted, leaving its jobId stale. Rebuild the
          // page job from the original image, remap the region, then retry the
          // user's Mask action transparently.
          const sourceResponse = await fetch(pageUrl, { cache: "no-store" });
          if (!sourceResponse.ok) throw caught;
          const refreshed = await cleanPage(pageUrl, await sourceResponse.blob(), true);
          current = refreshed;
          const recoveredRegionId = findRecoveredRegionId(
            previousRegion,
            refreshed.regions,
            resolvedRegionId,
          );
          if (!recoveredRegionId) {
            throw new CleaningClientError(
              404,
              "Cleaning job expired and the matching Mask region could not be restored.",
              "Re-clean this page and reopen Mask.",
            );
          }

          const recoveredRegion = refreshed.regions.find((region) => region.id === recoveredRegionId);
          if (!recoveredRegion) throw new Error("Recovered Mask region is unavailable.");
          const oldRect = previousRegion?.rect;
          const maskForRecoveredRegion = oldRect && JSON.stringify(oldRect) !== JSON.stringify(recoveredRegion.rect)
            ? await intersectMaskWithRegion(mask, recoveredRegion.rect)
            : maskForCurrentRegion;
          resolvedRegionId = recoveredRegionId;
          remapped = recoveredRegionId !== originalRegionId ||
            Boolean(oldRect && JSON.stringify(oldRect) !== JSON.stringify(recoveredRegion.rect));
          if (remapped || (oldRect && JSON.stringify(oldRect) !== JSON.stringify(recoveredRegion.rect))) {
            regionAliasRef.current.set(aliasKey, recoveredRegionId);
          }
          previousRegion = recoveredRegion;
          token = (pageTokensRef.current.get(pageUrl) ?? 0) + 1;
          pageTokensRef.current.set(pageUrl, token);
          activeRequestRef.current = { token, pageUrl };
          job = await retryCleaningRegion(
            refreshed.jobId,
            recoveredRegionId,
            maskForRecoveredRegion,
            cleaner,
            action,
          );
        }

        const result = await runJob(job, token, pageUrl, current.sourceFingerprint);
        return remapped
          ? { ...result, maskAdjustment: "remapped", recoveredRegionId: resolvedRegionId }
          : result;
      } catch (caught) {
        handleFailure(caught, pageUrl);
      } finally {
        setProgressState((previous) => (previous?.pageUrl === pageUrl ? undefined : previous));
        cancelOnPageChangeRef.current = false;
        if (activeRequestRef.current?.token === token && activeRequestRef.current?.pageUrl === pageUrl) {
          activeRequestRef.current = undefined;
        }
      }
    },
    [cleanPage, handleFailure, runJob],
  );

  useEffect(() => {
    if (restoreStartedRef.current || pages.length === 0) return;
    restoreStartedRef.current = true;
    let active = true;
    let completed = false;
    void (async () => {
      let saved: Awaited<ReturnType<typeof loadCleaningResultsMetadata>>;
      try {
        saved = await loadCleaningResultsMetadata();
      } catch (error) {
        // A metadata store failure must not kill the whole session restore —
        // the affected pages simply reclean.
        console.warn("Failed to load cleaning results metadata; skipping clean restore", error);
        return;
      }
      for (const [pageUrl, metadata] of saved) {
        if (
          !active ||
          !pagesRef.current.includes(pageUrl) ||
          resultsRef.current.has(pageUrl)
        ) {
          continue;
        }
        try {
          // A page URL can remain stable while its underlying image changes.
          // Verify the current source bytes before restoring a persisted clean
          // result; if the source cannot be read, safely leave it for reclean.
          if (!metadata.sourceFingerprint || !metadata.maskFingerprint || metadata.pipelineVersion !== CURRENT_PIPELINE_VERSION) {
            continue;
          }
          let sourceResponse: Response;
          try {
            sourceResponse = await fetch(pageUrl, { cache: "no-store" });
          } catch {
            continue;
          }
          if (!sourceResponse.ok) continue;
          const sourceBlob = await sourceResponse.blob();
          const sourceFingerprintValue = fingerprintBlob(sourceBlob);
          const sourceFingerprint = typeof sourceFingerprintValue === "string"
            ? sourceFingerprintValue
            : await sourceFingerprintValue;
          if (sourceFingerprint !== metadata.sourceFingerprint) continue;

          // Restoring with zero dimensions makes translationScope normalize
          // rects against zero (NaN boxes) and the page silently degrades to
          // clean-only — when dimensions are unusable, skip the fast path and
          // let the guarded hydration path below run instead.
          const canUseFastPath = !!metadata.width && !!metadata.height
            && metadata.width > 0 && metadata.height > 0;

          // Fast Path: Check if cleaning image blobs were persisted locally in IndexedDB!
          const localAssets = canUseFastPath
            ? await loadCleaningResultAssets(metadata)
            : null;
          if (localAssets && localAssets.cleanBlob && localAssets.maskBlob &&
            await fingerprintBlob(localAssets.maskBlob) === metadata.maskFingerprint) {
            const cleanUrl = URL.createObjectURL(localAssets.cleanBlob);
            const maskUrl = URL.createObjectURL(localAssets.maskBlob);
            const reviewMaskUrl = localAssets.reviewMaskBlob ? URL.createObjectURL(localAssets.reviewMaskBlob) : maskUrl;
            const protectedMaskUrl = localAssets.protectedMaskBlob ? URL.createObjectURL(localAssets.protectedMaskBlob) : maskUrl;

            const restored: PageCleaningResult = {
              jobId: metadata.jobId,
              sourceHash: metadata.sourceHash,
              width: metadata.width ?? 0,
              height: metadata.height ?? 0,
              cleanAsset: cleanUrl,
              maskAsset: maskUrl,
              reviewMaskAsset: reviewMaskUrl,
              protectedMaskAsset: protectedMaskUrl,
              regions: safeRestoredRegions(metadata.regions),
              timingsMs: metadata.timingsMs ?? {},
              awaitingReview: metadata.awaitingReview ?? metadata.regions.some(
                (region) => region.status === "needs_review" && region.automaticAction === "clean",
              ),
              pipelineVersion: metadata.pipelineVersion,
              cleaningMode: metadata.cleaningMode ?? "safe",
              cleanUrl,
              maskUrl,
              reviewMaskUrl,
              protectedMaskUrl,
              cleanBlob: localAssets.cleanBlob,
              maskBlob: localAssets.maskBlob ?? undefined,
              reviewMaskBlob: localAssets.reviewMaskBlob ?? undefined,
              protectedMaskBlob: localAssets.protectedMaskBlob ?? undefined,
              sourceFingerprint: metadata.sourceFingerprint,
              maskFingerprint: metadata.maskFingerprint,
              preparedIdentity: metadata.sourceFingerprint
                ? buildPreparedIdentity(
                    metadata.sourceFingerprint,
                    metadata.maskFingerprint ?? "unknown-mask",
                    metadata.pipelineVersion,
                    safeRestoredRegions(metadata.regions),
                    metadata.cleaningMode,
                  )
                : undefined,
            };

            if (
              !active ||
              !pagesRef.current.includes(pageUrl) ||
              resultsRef.current.has(pageUrl)
            ) {
              revokeResult(restored);
              if (!active) return;
              continue;
            }
            replaceResult(pageUrl, restored);
            // Restoring is local-only: the persisted revision-bound artwork
            // confirmations are re-seeded and the stored background is
            // inspected without any provider call and without altering pixels.
            if (metadata.artworkConfirmations?.length) {
              confirmationsRef.current.replacePage(pageUrl, metadata.artworkConfirmations);
            }
            await inspectPageRemnants(pageUrl, restored, sourceBlob);
            continue;
          }

          // Opening saved work reads local evidence only. Missing assets remain unavailable.
          if (pageUrl === pageUrlRef.current) setError({ message: "Saved cleaning assets are unavailable.", recovery: "reclean" });
        } catch {
          if (active && pageUrl === pageUrlRef.current) {
            setError({
              message: "Saved cleaning result is no longer available.",
              recovery: "reclean",
            });
          }
        }
      }
      completed = true;
    })();
    return () => {
      active = false;
      if (!completed) restoreStartedRef.current = false;
    };
  }, [hydrateResult, inspectPageRemnants, pages.length, replaceResult, revokeResult]);

  useEffect(() => {
    const retained = new Map<string, PageCleaningResult>();
    let removed = false;
    for (const [pageUrl, result] of resultsRef.current) {
      if (pagesRef.current.includes(pageUrl)) retained.set(pageUrl, result);
      else {
        revokeResult(result);
        removed = true;
      }
    }
    const retainedReviews = new Map(remnantReviewsRef.current);
    for (const pageUrl of textEvidenceRef.current.keys()) {
      if (!pagesRef.current.includes(pageUrl)) {
        textEvidenceRef.current.delete(pageUrl);
        inspectionTokensRef.current.set(pageUrl, (inspectionTokensRef.current.get(pageUrl) ?? 0) + 1);
      }
    }
    let reviewRemoved = false;
    for (const pageUrl of retainedReviews.keys()) {
      if (!pagesRef.current.includes(pageUrl)) {
        retainedReviews.delete(pageUrl);
        reviewBindingsRef.current.delete(pageUrl);
        confirmationsRef.current.invalidatePage(pageUrl);
        reviewRemoved = true;
      }
    }
    if (reviewRemoved) {
      remnantReviewsRef.current = retainedReviews;
      setRemnantReviews(retainedReviews);
    }
    if (!removed) return;
    resultsRef.current = retained;
    setResultsByPage(retained);
    setCacheRevision((revision) => revision + 1);
  }, [pages, revokeResult]);

  useEffect(
    () => () => {
      for (const [url, t] of pageTokensRef.current.entries()) {
        pageTokensRef.current.set(url, t + 1);
      }
      for (const result of resultsRef.current.values()) revokeResult(result);
    },
    [revokeResult],
  );

  const currentResult = useMemo(
    () => (currentPageUrl ? resultsByPage.get(currentPageUrl) : undefined),
    [currentPageUrl, resultsByPage],
  );
  const currentRemnantReview = useMemo(
    () => (currentPageUrl ? remnantReviews.get(currentPageUrl) : undefined),
    [currentPageUrl, remnantReviews],
  );
  const progress =
    progressState && progressState.pageUrl === currentPageUrl
      ? progressState.value
      : undefined;

  return {
    cleanPage,
    cleanCurrentPage,
    retryRegion,
    resolveMaskRegion,
    cancelPolling,
    currentResult,
    currentRemnantReview,
    getCurrentRemnantReview,
    setPageRemnantTextEvidence,
    recheckPageRemnants: async (pageUrl: string) => {
      const result = resultsRef.current.get(pageUrl);
      if (result) await inspectPageRemnants(pageUrl, result);
    },
    remnantReviews,
    confirmArtworkCandidate,
    progress,
    error,
    resultsByPage,
    cacheRevision,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
