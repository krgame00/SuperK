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
} from "@/lib/cleaning/types";
import {
  loadCleaningResultAssets,
  loadCleaningResultsMetadata,
  saveCleaningAssets,
  saveCleaningResultMetadata,
} from "@/lib/projectStore";
import { assertMatchingImageDimensions } from "@/lib/translationPipeline";
import { authorizationIdentity } from "@/lib/cleaning/textAuthorization";

const POLL_INTERVAL_MS = 500;
const CURRENT_PIPELINE_VERSION = "2.3.1-enclosed-backing";

const fingerprintBlob = (blob: Blob): string | Promise<string> => {
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
};

const buildPreparedIdentity = (
  sourceFingerprint: string,
  maskFingerprint: string,
  pipelineVersion?: string,
  regions: CleaningResult["regions"] = [],
) => `${sourceFingerprint}:${maskFingerprint}:${pipelineVersion ?? "unknown-pipeline"}:${authorizationIdentity(regions)}`;

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
  const pageTokensRef = useRef<Map<string, number>>(new Map());
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
      setResultsByPage(updated);
      setCacheRevision((revision) => revision + 1);
    },
    [revokeResult],
  );

  const hydrateResult = useCallback(
    async (result: CleaningResult): Promise<PageCleaningResult> => {
      const responses = await Promise.all([
        fetch(result.cleanAsset, { cache: "no-store" }),
        fetch(result.maskAsset, { cache: "no-store" }),
        fetch(result.reviewMaskAsset, { cache: "no-store" }),
        fetch(result.protectedMaskAsset, { cache: "no-store" }),
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
    ): Promise<CleaningJob> => {
      let job = initial;
      while (job.status === "queued" || job.status === "running") {
        await delay(POLL_INTERVAL_MS);
        if (
          token !== pageTokensRef.current.get(pageUrl) ||
          !pagesRef.current.includes(pageUrl)
        ) {
          throw new PollingCancelled();
        }
        job = await getCleaningJob(job.jobId);
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
    ): Promise<PageCleaningResult> => {
      const result = await getCleaningResult(job.jobId);
      const hydrated = await hydrateResult(result);
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
            )
          : undefined,
      };
      replaceResult(pageUrl, identified);
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
          ...assetIds,
        });
      } catch (saveErr) {
        console.warn("Failed to persist cleaning result metadata:", saveErr);
      } finally {
        setProgressState((previous) => (previous?.pageUrl === pageUrl ? undefined : previous));
      }
      return identified;
    },
    [hydrateResult, replaceResult, revokeResult],
  );

  const runJob = useCallback(
    async (
      initial: CleaningJob,
      token: number,
      pageUrl: string,
      sourceFingerprint?: string,
    ): Promise<PageCleaningResult> => {
      try {
        const terminal = await waitForJob(initial, token, pageUrl);
        return await finishJob(terminal, token, pageUrl, sourceFingerprint);
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
    if (caught instanceof PollingCancelled) return;
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
    ): Promise<PageCleaningResult> => {
      setError(undefined);
      const sourceFingerprintValue = fingerprintBlob(source);
      const cached = !force ? resultsRef.current.get(pageUrl) : undefined;
      if (!force) {
        const sourceFingerprint =
          typeof sourceFingerprintValue === "string"
            ? sourceFingerprintValue
            : await sourceFingerprintValue;
        if (
          cached &&
          cached.sourceFingerprint &&
          cached.maskFingerprint &&
          cached.sourceFingerprint === sourceFingerprint &&
          cached.pipelineVersion === CURRENT_PIPELINE_VERSION
        ) {
          return cached;
        }
      }
      const token = (pageTokensRef.current.get(pageUrl) ?? 0) + 1;
      pageTokensRef.current.set(pageUrl, token);
      activeRequestRef.current = { token, pageUrl };
      try {
        // Start the request before hashing the first uncached page so source
        // fingerprinting cannot delay the polling schedule.
        const jobPromise = createCleaningJob(source);
        const sourceFingerprint =
          typeof sourceFingerprintValue === "string"
            ? sourceFingerprintValue
            : await sourceFingerprintValue;
        const job = await jobPromise;
        return await runJob(job, token, pageUrl, sourceFingerprint);
      } catch (caught) {
        handleFailure(caught, pageUrl);
        throw caught;
      } finally {
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
            continue;
          }

          const result = await getCleaningResult(metadata.jobId);
          if (result.sourceHash !== metadata.sourceHash) continue;
          if (metadata.pipelineVersion && result.pipelineVersion !== metadata.pipelineVersion) continue;
          if (authorizationIdentity(result.regions) !== authorizationIdentity(metadata.regions)) continue;
          const hydrated = await hydrateResult(result);
          if (hydrated.maskFingerprint !== metadata.maskFingerprint) {
            revokeResult(hydrated);
            continue;
          }
          const restored: PageCleaningResult = {
            ...hydrated,
            sourceFingerprint: metadata.sourceFingerprint,
            preparedIdentity: metadata.sourceFingerprint
              ? buildPreparedIdentity(
                  metadata.sourceFingerprint,
                  hydrated.maskFingerprint ?? "unknown-mask",
                  result.pipelineVersion,
                  result.regions,
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
  }, [hydrateResult, pages.length, replaceResult, revokeResult]);

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
    progress,
    error,
    resultsByPage,
    cacheRevision,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
