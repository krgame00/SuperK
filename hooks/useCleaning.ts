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

export interface PageCleaningResult extends CleaningResult {
  cleanUrl: string;
  maskUrl: string;
  reviewMaskUrl: string;
  protectedMaskUrl: string;
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
  const [progressState, setProgressState] = useState<{
    pageUrl: string;
    value: CleaningProgress;
  }>();
  const [error, setError] = useState<CleaningHookError>();
  const tokenRef = useRef(0);
  const currentPageUrl = pages[currentPage];
  const pageUrlRef = useRef(currentPageUrl);
  const pagesRef = useRef(pages);
  const resultsRef = useRef(resultsByPage);
  const restoreStartedRef = useRef(false);
  const cancelOnPageChangeRef = useRef(false);
  const activeRequestRef = useRef<
    { token: number; pageUrl: string } | undefined
  >(undefined);
  pagesRef.current = pages;

  useEffect(() => {
    resultsRef.current = resultsByPage;
  }, [resultsByPage]);

  const cancelPolling = useCallback(() => {
    tokenRef.current += 1;
    setProgressState(undefined);
  }, []);

  useEffect(() => {
    const pageChanged = pageUrlRef.current !== currentPageUrl;
    pageUrlRef.current = currentPageUrl;
    const activeRequest = activeRequestRef.current;
    if (
      activeRequest &&
      (!pagesRef.current.includes(activeRequest.pageUrl) ||
        (cancelOnPageChangeRef.current && pageChanged))
    ) {
      tokenRef.current += 1;
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
        await Promise.all(responses.map((response) => response.blob()));
      if (typeof createImageBitmap !== "function") {
        throw new Error(
          "Cleaning failed: cannot validate clean image dimensions in this browser.",
        );
      }
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
          token !== tokenRef.current ||
          !pagesRef.current.includes(pageUrl)
        ) {
          throw new PollingCancelled();
        }
        job = await getCleaningJob(job.jobId);
        if (job.progress) setProgressState({ pageUrl, value: job.progress });
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Image cleaning failed.");
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
    ): Promise<PageCleaningResult> => {
      const result = await getCleaningResult(job.jobId);
      const hydrated = await hydrateResult(result);
      if (
        token !== tokenRef.current ||
        !pagesRef.current.includes(pageUrl)
      ) {
        revokeResult(hydrated);
        throw new PollingCancelled();
      }
      replaceResult(pageUrl, hydrated);
      await saveCleaningResultMetadata({
        pageUrl,
        sourceHash: result.sourceHash,
        jobId: result.jobId,
        regions: result.regions,
        updatedAt: Date.now(),
      });
      setProgressState(undefined);
      return hydrated;
    },
    [hydrateResult, replaceResult, revokeResult],
  );

  const runJob = useCallback(
    async (
      initial: CleaningJob,
      token: number,
      pageUrl: string,
    ): Promise<PageCleaningResult> => {
      const terminal = await waitForJob(initial, token, pageUrl);
      return finishJob(terminal, token, pageUrl);
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
    ): Promise<PageCleaningResult> => {
      setError(undefined);
      const cached = resultsRef.current.get(pageUrl);
      if (cached) return cached;
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      activeRequestRef.current = { token, pageUrl };
      try {
        const job = await createCleaningJob(source);
        return await runJob(job, token, pageUrl);
      } catch (caught) {
        handleFailure(caught);
        throw caught;
      } finally {
        if (activeRequestRef.current?.token === token) {
          activeRequestRef.current = undefined;
        }
      }
    },
    [handleFailure, runJob],
  );

  const cleanCurrentPage = useCallback(
    async (source: Blob): Promise<void> => {
      const pageUrl = pageUrlRef.current;
      if (!pageUrl || resultsRef.current.has(pageUrl)) return;
      cancelOnPageChangeRef.current = true;
      try {
        await cleanPage(pageUrl, source);
      } catch {
        // CleaningToolbar renders the structured hook error.
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
      const token = tokenRef.current + 1;
      tokenRef.current = token;
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
        return await runJob(job, token, pageUrl);
      } catch (caught) {
        handleFailure(caught);
      } finally {
        cancelOnPageChangeRef.current = false;
        if (activeRequestRef.current?.token === token) {
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
          const result = await getCleaningResult(metadata.jobId);
          if (result.sourceHash !== metadata.sourceHash) continue;
          const hydrated = await hydrateResult(result);
          if (
            !active ||
            !pagesRef.current.includes(pageUrl) ||
            resultsRef.current.has(pageUrl)
          ) {
            revokeResult(hydrated);
            if (!active) return;
            continue;
          }
          replaceResult(pageUrl, hydrated);
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
  }, [pages, revokeResult]);

  useEffect(
    () => () => {
      tokenRef.current += 1;
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
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
