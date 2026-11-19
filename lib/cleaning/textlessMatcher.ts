import {
  detectTextlessPair,
  type TextlessPairBox,
  type TextlessPairResult,
} from "./client";

export interface MatchablePage {
  url: string;
  name: string;
}

export interface PageFingerprint {
  index: number;
  hash: bigint;
  aspect: number;
  normalizedStem: string;
  hasCleanKeyword: boolean;
}

export interface TextlessMatchedPair<T extends MatchablePage = MatchablePage> {
  textPage: T;
  textlessPage: T;
  scaledCleanBlob: Blob;
  similarity: number;
  textBlocksCount: number;
  backgroundVariant?: "with_bubbles" | "bubbleless" | "none";
  detectedBoxes?: TextlessPairBox[];
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

const CLEAN_FILENAME_REGEX = /(?:^|[_\-\s.])(textless|clean|notext|no_text|blank|raw|mojinashi)(?:$|[_\-\s.])/i;

export function parseFilenameHint(name: string): { normalizedStem: string; hasCleanKeyword: boolean } {
  const withoutExt = name.replace(/\.[^/.]+$/, "").trim();
  const hasCleanKeyword = CLEAN_FILENAME_REGEX.test(withoutExt);
  const normalizedStem = withoutExt
    .replace(CLEAN_FILENAME_REGEX, "")
    .replace(/[_\-\s]+/g, "")
    .toLowerCase();
  return { normalizedStem, hasCleanKeyword };
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let dist = 0;
  const zero = BigInt(0);
  const one = BigInt(1);
  while (xor > zero) {
    xor &= xor - one;
    dist += 1;
  }
  return dist;
}

export async function computeBrowserDHash(
  blob: Blob,
): Promise<{ hash: bigint; aspect: number } | null> {
  if (typeof createImageBitmap !== "function") {
    return null;
  }
  try {
    const bmp = await createImageBitmap(blob);
    try {
      const aspect = bmp.width / Math.max(1, bmp.height);
      let cvs: HTMLCanvasElement | OffscreenCanvas;
      let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
      if (typeof OffscreenCanvas !== "undefined") {
        cvs = new OffscreenCanvas(9, 8);
        ctx = cvs.getContext("2d", { willReadFrequently: true });
      } else if (typeof document !== "undefined") {
        cvs = document.createElement("canvas");
        cvs.width = 9;
        cvs.height = 8;
        ctx = cvs.getContext("2d", { willReadFrequently: true });
      }
      if (!ctx) return null;

      ctx.drawImage(bmp, 0, 0, 9, 8);
      const { data } = ctx.getImageData(0, 0, 9, 8);
      let hash = BigInt(0);
      const one = BigInt(1);
      const zero = BigInt(0);
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const left = (y * 9 + x) * 4;
          const right = (y * 9 + x + 1) * 4;
          const lumaL = data[left] * 0.299 + data[left + 1] * 0.587 + data[left + 2] * 0.114;
          const lumaR = data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114;
          hash = (hash << one) | (lumaL > lumaR ? one : zero);
        }
      }
      return { hash, aspect };
    } finally {
      bmp.close?.();
    }
  } catch {
    return null;
  }
}

export function findCandidatePairs(
  fingerprints: PageFingerprint[],
  maxHamming = 12,
  maxAspectDiff = 0.04,
): Array<[number, number]> {
  const used = new Set<number>();
  const candidates: Array<[number, number]> = [];

  for (let i = 0; i < fingerprints.length; i += 1) {
    if (used.has(i)) continue;
    const fpA = fingerprints[i];
    let bestJ = -1;
    let bestScore = Infinity;

    for (let j = i + 1; j < fingerprints.length; j += 1) {
      if (used.has(j)) continue;
      const fpB = fingerprints[j];
      const aspectDiff = Math.abs(fpA.aspect - fpB.aspect) / Math.max(fpA.aspect, 1e-6);
      if (aspectDiff > maxAspectDiff) continue;

      const dist = hammingDistance64(fpA.hash, fpB.hash);
      const sameStemBonus =
        fpA.normalizedStem.length > 0 &&
        fpA.normalizedStem === fpB.normalizedStem &&
        fpA.hasCleanKeyword !== fpB.hasCleanKeyword
          ? -6
          : 0;
      const adjacentBonus = j === i + 1 ? -2 : 0;
      const effectiveScore = dist + sameStemBonus + adjacentBonus;

      if (dist <= maxHamming && effectiveScore < bestScore) {
        bestScore = effectiveScore;
        bestJ = j;
      }
    }

    if (bestJ !== -1) {
      used.add(i);
      used.add(bestJ);
      candidates.push([i, bestJ]);
    }
  }

  return candidates;
}

async function dataUrlToBlob(dataUrl: string, fetcher: typeof fetch): Promise<Blob> {
  const res = await fetcher(dataUrl);
  return await res.blob();
}

/**
 * Scans uploaded pages to pair with-text pages with their textless clean counterparts.
 * Supports Zero-Copy blob reuse when dimensions match, and fails open on errors.
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
        (detection.scaled_textless_base64 || detection.needs_resize === false) &&
        (detection.text_role === "a_has_text" || detection.text_role === "b_has_text")
      ) {
        const textPage = detection.text_role === "a_has_text" ? pageA : pageB;
        const textlessPage = detection.text_role === "a_has_text" ? pageB : pageA;
        const textBlocksCount =
          detection.text_role === "a_has_text" ? detection.text_blocks_a : detection.text_blocks_b;

        // Zero-copy: if needs_resize is false, reuse original textless blob without re-encoding
        const scaledCleanBlob = detection.scaled_textless_base64
          ? await dataUrlToBlob(detection.scaled_textless_base64, fetcher)
          : (detection.text_role === "a_has_text" ? blobB : blobA);

        matchedPairs.push({
          textPage,
          textlessPage,
          scaledCleanBlob,
          similarity: detection.similarity,
          textBlocksCount,
          backgroundVariant: detection.background_variant,
          detectedBoxes: detection.detected_boxes,
        });
        detachedByTextPageUrl.set(textPage.url, textlessPage);
        filteredPages.push(textPage);
        options.onProgress?.(Math.min(i + 2, totalPairs), totalPairs);
        i += 2;
        continue;
      }
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
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
