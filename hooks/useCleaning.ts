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
  ManualRegionAction,
} from "@/lib/cleaning/types";
import {
  loadCleaningResultsMetadata,
  saveCleaningResultMetadata,
} from "@/lib/projectStore";
import { assertMatchingImageDimensions } from "@/lib/translationPipeline";

const POLL_INTERVAL_MS = 500;
const CURRENT_PIPELINE_VERSION = "2.2.0-adaptive-roi";

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
) => `${sourceFingerprint}:${maskFingerprint}:${pipelineVersion ?? "unknown-pipeline"}`;

export interface PageCleaningResult extends CleaningResult {
  cleanUrl: string;
  maskUrl: string;
  reviewMaskUrl: string;
  protectedMaskUrl: string;
  sourceFingerprint?: string;
  /** Missing on legacy/restored results; such entries are never reused. */
  maskFingerprint?: string;
  preparedIdentity?: string;
}
export interface CleaningHookError {
  message: string;
  recovery: "retry" | "start-local-service" | "reclean";
}
interface UseCleaningInput {
  pages: string[];
  currentPage: number;
}
class PollingCancelled extends Error {}

export function useCleaning({ pages, currentPage }: UseCleaningInput) {
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
  const resultsRef = useRef(resultsByPage);
  const restoreStartedRef = useRef(false);
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
            )
          : undefined,
      };
      replaceResult(pageUrl, identified);
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
      });
      setProgressState((previous) => (previous?.pageUrl === pageUrl ? undefined : previous));
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
      const terminal = await waitForJob(initial, token, pageUrl);
      return finishJob(terminal, token, pageUrl, sourceFingerprint);
    },
    [finishJob, waitForJob],
  );

  const handleFailure = useCallback((caught: unknown) => {
    if (caught instanceof PollingCancelled) return;
    if (caught instanceof CleaningClientError && caught.status === 503) {
      setError({ message: caught.message, recovery: "start-local-service" });
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
        handleFailure(caught);
        throw caught;
      } finally {
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

  const retryRegion = useCallback(
    async (
      regionId: string,
      mask: Blob,
      cleaner: CleanerOverride = "auto",
      action: ManualRegionAction = "automatic",
    ): Promise<PageCleaningResult | undefined> => {
      const pageUrl = pageUrlRef.current;
      const current = pageUrl
        ? resultsRef.current.get(pageUrl)
        : undefined;
      if (!pageUrl || !current) return;
      const token = (pageTokensRef.current.get(pageUrl) ?? 0) + 1;
      pageTokensRef.current.set(pageUrl, token);
      activeRequestRef.current = { token, pageUrl };
      cancelOnPageChangeRef.current = true;
      setError(undefined);
      try {
        const job = await retryCleaningRegion(
          current.jobId,
          regionId,
          mask,
          cleaner,
          action,
        );
        return await runJob(job, token, pageUrl, current.sourceFingerprint);
      } catch (caught) {
        handleFailure(caught);
      } finally {
        cancelOnPageChangeRef.current = false;
        if (activeRequestRef.current?.token === token && activeRequestRef.current?.pageUrl === pageUrl) {
          activeRequestRef.current = undefined;
        }
      }
    },
    [handleFailure, runJob],
  );

  useEffect(() => {
    if (restoreStartedRef.current || pages.length === 0) return;
    restoreStartedRef.current = true;
    let active = true;
    let completed = false;
    void (async () => {
      const saved = await loadCleaningResultsMetadata();
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

          const result = await getCleaningResult(metadata.jobId);
          if (result.sourceHash !== metadata.sourceHash) continue;
          if (metadata.pipelineVersion && result.pipelineVersion !== metadata.pipelineVersion) continue;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Prunes revoked blob results on page removal
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
