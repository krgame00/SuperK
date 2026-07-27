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
} from "@/lib/cleaning/types";
import {
  loadCleaningResultsMetadata,
  saveCleaningResultMetadata,
} from "@/lib/projectStore";

const POLL_INTERVAL_MS = 500;

export interface PageCleaningResult extends CleaningResult {
  cleanUrl: string;
  maskUrl: string;
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
  const resultsRef = useRef(resultsByPage);
  const restoreStartedRef = useRef(false);

  useEffect(() => {
    resultsRef.current = resultsByPage;
  }, [resultsByPage]);

  const cancelPolling = useCallback(() => {
    tokenRef.current += 1;
    setProgressState(undefined);
  }, []);

  useEffect(() => {
    pageUrlRef.current = currentPageUrl;
    tokenRef.current += 1;
  }, [currentPageUrl]);

  const revokeResult = useCallback((result: PageCleaningResult) => {
    URL.revokeObjectURL(result.cleanUrl);
    URL.revokeObjectURL(result.maskUrl);
  }, []);

  const replaceResult = useCallback(
    (pageUrl: string, next: PageCleaningResult) => {
      setResultsByPage((previous) => {
        const old = previous.get(pageUrl);
        if (old) revokeResult(old);
        const updated = new Map(previous);
        updated.set(pageUrl, next);
        return updated;
      });
    },
    [revokeResult],
  );

  const hydrateResult = useCallback(
    async (result: CleaningResult): Promise<PageCleaningResult> => {
      const [cleanResponse, maskResponse] = await Promise.all([
        fetch(result.cleanAsset, { cache: "no-store" }),
        fetch(result.maskAsset, { cache: "no-store" }),
      ]);
      if (!cleanResponse.ok || !maskResponse.ok) {
        throw new CleaningClientError(
          Math.max(cleanResponse.status, maskResponse.status),
          "Saved cleaning assets are unavailable.",
          "Clean this page again.",
        );
      }
      const [cleanBlob, maskBlob] = await Promise.all([
        cleanResponse.blob(),
        maskResponse.blob(),
      ]);
      return {
        ...result,
        cleanUrl: URL.createObjectURL(cleanBlob),
        maskUrl: URL.createObjectURL(maskBlob),
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
          pageUrl !== pageUrlRef.current
        ) {
          throw new PollingCancelled();
        }
        job = await getCleaningJob(job.jobId);
        if (job.progress) {
          setProgressState({ pageUrl, value: job.progress });
        }
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Image cleaning failed.");
      }
      return job;
    },
    [],
  );

  const finishJob = useCallback(
    async (job: CleaningJob, token: number, pageUrl: string) => {
      const result = await getCleaningResult(job.jobId);
      const hydrated = await hydrateResult(result);
      if (token !== tokenRef.current || pageUrl !== pageUrlRef.current) {
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
    },
    [hydrateResult, replaceResult, revokeResult],
  );

  const runJob = useCallback(
    async (
      initial: CleaningJob,
      token: number,
      pageUrl: string,
    ): Promise<void> => {
      const terminal = await waitForJob(initial, token, pageUrl);
      await finishJob(terminal, token, pageUrl);
    },
    [finishJob, waitForJob],
  );

  const handleFailure = useCallback((caught: unknown) => {
    if (caught instanceof PollingCancelled) return;
    if (caught instanceof CleaningClientError && caught.status === 503) {
      setError({
        message: caught.message,
        recovery: "start-local-service",
      });
      return;
    }
    setError({
      message:
        caught instanceof Error ? caught.message : "Image cleaning failed.",
      recovery: "retry",
    });
  }, []);

  const cleanCurrentPage = useCallback(
    async (source: Blob): Promise<void> => {
      const pageUrl = pageUrlRef.current;
      if (!pageUrl || resultsRef.current.has(pageUrl)) return;
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      setError(undefined);
      try {
        const job = await createCleaningJob(source);
        await runJob(job, token, pageUrl);
      } catch (caught) {
        handleFailure(caught);
      }
    },
    [handleFailure, runJob],
  );

  const retryRegion = useCallback(
    async (
      regionId: string,
      mask: Blob,
      cleaner: CleanerOverride = "auto",
    ): Promise<void> => {
      const pageUrl = pageUrlRef.current;
      const current = pageUrl
        ? resultsRef.current.get(pageUrl)
        : undefined;
      if (!pageUrl || !current) return;
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      setError(undefined);
      try {
        const job = await retryCleaningRegion(
          current.jobId,
          regionId,
          mask,
          cleaner,
        );
        await runJob(job, token, pageUrl);
      } catch (caught) {
        handleFailure(caught);
      }
    },
    [handleFailure, runJob],
  );

  useEffect(() => {
    if (restoreStartedRef.current || pages.length === 0) return;
    restoreStartedRef.current = true;
    let active = true;
    void (async () => {
      const saved = await loadCleaningResultsMetadata();
      for (const [pageUrl, metadata] of saved) {
        if (!active || !pages.includes(pageUrl)) continue;
        try {
          const result = await getCleaningResult(metadata.jobId);
          if (result.sourceHash !== metadata.sourceHash) continue;
          const hydrated = await hydrateResult(result);
          if (!active) {
            revokeResult(hydrated);
            return;
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
    })();
    return () => {
      active = false;
    };
  }, [hydrateResult, pages, replaceResult, revokeResult]);

  useEffect(() => {
    if (pages.length !== 0) return;
    for (const result of resultsRef.current.values()) revokeResult(result);
    queueMicrotask(() => {
      resultsRef.current = new Map();
      setResultsByPage(new Map());
    });
  }, [pages.length, revokeResult]);

  useEffect(
    () => () => {
      tokenRef.current += 1;
      for (const result of resultsRef.current.values()) revokeResult(result);
    },
    [revokeResult],
  );

  const currentResult = useMemo(
    () =>
      currentPageUrl ? resultsByPage.get(currentPageUrl) : undefined,
    [currentPageUrl, resultsByPage],
  );
  const progress =
    progressState?.pageUrl === currentPageUrl
      ? progressState.value
      : undefined;

  return {
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
