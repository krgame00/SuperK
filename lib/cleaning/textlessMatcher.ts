import { detectTextlessPair, type TextlessPairResult } from "./client";

export interface MatchablePage {
  url: string;
  name: string;
}

export interface TextlessMatchedPair<T extends MatchablePage = MatchablePage> {
  textPage: T;
  textlessPage: T;
  scaledCleanBlob: Blob;
  similarity: number;
  textBlocksCount: number;
}

export interface TextlessBatchMatchResult<T extends MatchablePage = MatchablePage> {
  filteredPages: T[];
  matchedPairs: TextlessMatchedPair<T>[];
  detachedByTextPageUrl: Map<string, T>;
}

export interface DetectTextlessBatchOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  pairDetector?: (blobA: Blob, blobB: Blob, signal?: AbortSignal) => Promise<TextlessPairResult>;
  onProgress?: (completed: number, total: number) => void;
}

async function dataUrlToBlob(dataUrl: string, fetcher: typeof fetch): Promise<Blob> {
  const res = await fetcher(dataUrl);
  return await res.blob();
}

/**
 * Scans adjacent uploaded pages `(i, i+1)` to pair with-text pages with their
 * textless clean counterparts, scaling the textless image to match dimensions.
 * Fails open on offline/network errors so user pages are never dropped.
 */
export async function detectAndPairTextlessPages<T extends MatchablePage>(
  pages: T[],
  options: DetectTextlessBatchOptions = {},
): Promise<TextlessBatchMatchResult<T>> {
  const fetcher = options.fetcher ?? fetch;
  const pairDetector = options.pairDetector ?? detectTextlessPair;

  if (pages.length < 2) {
    return {
      filteredPages: [...pages],
      matchedPairs: [],
      detachedByTextPageUrl: new Map(),
    };
  }

  const filteredPages: T[] = [];
  const matchedPairs: TextlessMatchedPair<T>[] = [];
  const detachedByTextPageUrl = new Map<string, T>();
  const totalPairs = pages.length - 1;

  let i = 0;
  while (i < pages.length) {
    if (options.signal?.aborted) break;

    if (i + 1 >= pages.length) {
      filteredPages.push(pages[i]);
      break;
    }

    const pageA = pages[i];
    const pageB = pages[i + 1];

    try {
      const [resA, resB] = await Promise.all([
        fetcher(pageA.url, { signal: options.signal }),
        fetcher(pageB.url, { signal: options.signal }),
      ]);
      if (!resA.ok || !resB.ok) {
        filteredPages.push(pageA);
        options.onProgress?.(Math.min(i + 1, totalPairs), totalPairs);
        i += 1;
        continue;
      }

      const [blobA, blobB] = await Promise.all([resA.blob(), resB.blob()]);
      const detection = await pairDetector(blobA, blobB, options.signal);

      if (
        detection.is_match &&
        detection.scaled_textless_base64 &&
        (detection.text_role === "a_has_text" || detection.text_role === "b_has_text")
      ) {
        const textPage = detection.text_role === "a_has_text" ? pageA : pageB;
        const textlessPage = detection.text_role === "a_has_text" ? pageB : pageA;
        const textBlocksCount =
          detection.text_role === "a_has_text" ? detection.text_blocks_a : detection.text_blocks_b;
        const scaledCleanBlob = await dataUrlToBlob(detection.scaled_textless_base64, fetcher);

        matchedPairs.push({
          textPage,
          textlessPage,
          scaledCleanBlob,
          similarity: detection.similarity,
          textBlocksCount,
        });
        detachedByTextPageUrl.set(textPage.url, textlessPage);
        filteredPages.push(textPage);
        options.onProgress?.(Math.min(i + 2, totalPairs), totalPairs);
        i += 2;
        continue;
      }
    } catch (error) {
      // A caller-cancelled scan must stop, not silently continue pairing.
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
      // Fail open: keep original page if cleaner service is offline or times out.
    }

    filteredPages.push(pageA);
    options.onProgress?.(Math.min(i + 1, totalPairs), totalPairs);
    i += 1;
  }

  return {
    filteredPages,
    matchedPairs,
    detachedByTextPageUrl,
  };
}
