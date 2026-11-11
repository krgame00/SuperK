/**
 * Cross-Page Context Aggregator for Manga & Comic Translation
 *
 * Grounded in Blueprint Section 5 and Competitive Analysis (Torii Parity):
 * - Solves character pronoun drift and terminology desynchronization across consecutive pages.
 * - Extracts canonical translated dialogue from preceding pages in a sliding window.
 * - Formats compact, token-budgeted prompt directives for Gemini / LLM translation APIs.
 *
 * pstack principles:
 * - principle-model-the-domain: Typed PageDialogueSnapshot, ContextLine, and CrossPageContextOptions.
 * - principle-fix-root-causes: Addresses cross-page tone and naming inconsistencies at the prompt boundary.
 * - principle-laziness-protocol: Pure string builder with token-safe length clamping and zero external dependencies.
 */

import { type TranslatedBubble } from "@/lib/translationOverlay";
import { sortBubblesHierarchicalDAG } from "./panelReadingFlowDAG";

export interface ContextLine {
  sourceText?: string;
  translatedText: string;
}

export interface PageDialogueSnapshot {
  pageIndex: number;
  pageName?: string;
  lines: ContextLine[];
}

export interface CrossPageContextOptions {
  /** Maximum number of previous pages to include in the context window. Default: 3 */
  maxPreviousPages?: number;
  /** Maximum total character budget for the aggregated context string. Default: 1500 */
  maxContextChars?: number;
  /** Maximum dialogue lines per previous page. Default: 12 */
  maxLinesPerPage?: number;
}

/**
 * Extracts a structured dialogue snapshot from a page's translated bubbles.
 * Ignores deleted bubbles and bubbles without translated text.
 */
export function extractPageDialogueSnapshot(
  bubbles: readonly TranslatedBubble[] | undefined,
  pageIndex: number,
  pageName?: string,
): PageDialogueSnapshot | null {
  if (!bubbles || bubbles.length === 0) {
    return null;
  }

  // Filter valid, non-deleted translated dialogue bubbles
  const eligibleBubbles = bubbles.filter((b) => {
    if (b.deleted) return false;
    const text = (b.t || b.translated || "").trim();
    return text.length > 0;
  });

  if (eligibleBubbles.length === 0) {
    return null;
  }

  // Sort bubbles in canonical manga reading order (DAG)
  const ordered = sortBubblesHierarchicalDAG(eligibleBubbles);

  const lines: ContextLine[] = [];
  for (const b of ordered) {
    const translatedText = (b.t || b.translated || "").trim();
    const sourceText = (b.original_text || "").trim();
    if (translatedText) {
      lines.push({
        sourceText: sourceText || undefined,
        translatedText,
      });
    }
  }

  return {
    pageIndex,
    pageName,
    lines,
  };
}

/**
 * Builds the compact context string from an array of prior page snapshots.
 * Adheres to maxLinesPerPage and maxContextChars budget constraints.
 */
export function buildCrossPageContextString(
  snapshots: readonly PageDialogueSnapshot[],
  options?: CrossPageContextOptions,
): string {
  if (!snapshots || snapshots.length === 0) {
    return "";
  }

  const maxLinesPerPage = options?.maxLinesPerPage ?? 12;
  const maxContextChars = options?.maxContextChars ?? 1500;

  const sections: string[] = [];
  let totalChars = 0;

  for (const snapshot of snapshots) {
    if (!snapshot.lines || snapshot.lines.length === 0) continue;

    const label = snapshot.pageName
      ? `Page ${snapshot.pageIndex + 1} (${snapshot.pageName})`
      : `Page ${snapshot.pageIndex + 1}`;

    const pageLines: string[] = [];
    const linesToTake = snapshot.lines.slice(0, maxLinesPerPage);

    for (const item of linesToTake) {
      let lineStr: string;
      if (item.sourceText && item.sourceText !== item.translatedText) {
        lineStr = `- "${item.sourceText}" -> "${item.translatedText}"`;
      } else {
        lineStr = `- "${item.translatedText}"`;
      }
      pageLines.push(lineStr);
    }

    if (pageLines.length > 0) {
      const sectionStr = `[${label}]\n${pageLines.join("\n")}`;
      if (totalChars + sectionStr.length > maxContextChars && sections.length > 0) {
        break;
      }
      sections.push(sectionStr);
      totalChars += sectionStr.length + 2;
    }
  }

  return sections.join("\n\n").trim();
}

/**
 * Collects and aggregates prior pages' translated context for a given page index.
 * Looks backward through prior completed pages up to maxPreviousPages.
 */
export function collectPreviousPagesContext(
  pages: readonly string[],
  currentPageIndex: number,
  getPageBubbles: (pageUrl: string) => readonly TranslatedBubble[] | undefined,
  options?: CrossPageContextOptions,
): string {
  if (!pages || currentPageIndex <= 0 || pages.length === 0) {
    return "";
  }

  const maxPreviousPages = options?.maxPreviousPages ?? 3;
  const startIndex = Math.max(0, currentPageIndex - maxPreviousPages);
  const snapshots: PageDialogueSnapshot[] = [];

  for (let idx = startIndex; idx < currentPageIndex; idx++) {
    const pageUrl = pages[idx];
    if (!pageUrl) continue;

    const bubbles = getPageBubbles(pageUrl);
    const snapshot = extractPageDialogueSnapshot(bubbles, idx);
    if (snapshot && snapshot.lines.length > 0) {
      snapshots.push(snapshot);
    }
  }

  return buildCrossPageContextString(snapshots, options);
}
