import type { ReadabilityFinding } from "./readabilityScan";

export interface ReadabilityPageSnapshot {
  pageUrl: string;
  revision: string;
  findings: ReadabilityFinding[];
  unavailable?: string;
}

/** Only a completed scan with known results can be acknowledged. */
export function readabilityAcknowledgmentKey(pages: ReadabilityPageSnapshot[]): string | null {
  if (pages.some((page) => page.unavailable || page.findings.some((finding) => finding.kind === "color-unavailable"))) {
    return null;
  }
  const warnings = pages.flatMap((page) => page.findings.map((finding) => [
    page.pageUrl,
    page.revision,
    finding.bubbleId,
    finding.kind,
  ].join("\u0000"))).sort();
  if (warnings.length === 0) return null;
  return JSON.stringify(warnings);
}
