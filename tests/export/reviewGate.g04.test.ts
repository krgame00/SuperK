import { describe, expect, it } from "vitest";

import {
  getUnconfirmedPages as scanPages,
  getPageOutputBlockers as scanBlockers,
} from "@/lib/export/reviewGate";
import { withReviewIdentity, type TranslationReview } from "@/lib/translation/qualityReview";
import {
  applyArtworkConfirmations,
  backgroundEligibilityState,
  confirmCandidateArtwork,
  inspectBackgroundRemnants,
} from "@/lib/cleaning/backgroundRemnantInspection";
import type { TranslatedBubble } from "@/lib/translationOverlay";

// ── Fixtures ────────────────────────────────────────────────────────────────

const acceptedReview = (source: string, text: string): TranslationReview =>
  withReviewIdentity({ status: "accepted", sourceText: source, reviewedText: text }, "th", "src-1");

/** Old accepted snapshot that exactly matches the (contaminated) raw text: the pre-G04 bypass state. */
const oldAcceptedContaminated = (): TranslatedBubble => ({
  box: [0, 0, 100, 100],
  t: "รอก่อนא",
  original_text: "Wait.",
  translationReview: acceptedReview("Wait.", "รอก่อนא"),
});

const cleanVerified = (): TranslatedBubble => ({
  box: [0, 0, 100, 100],
  t: "รอก่อน",
  original_text: "Wait.",
  translationReview: acceptedReview("Wait.", "รอก่อน"),
});

const manualUnverified = (): TranslatedBubble => ({
  box: [0, 0, 100, 100],
  t: "พิมพ์เอง",
  original_text: "Typed.",
});

const page = (url: string, extra: Record<string, unknown> = {}) => ({ url, name: url, ...extra });
const bubbles = (url: string, list: TranslatedBubble[]) => new Map([[url, list]]);

// Synthetic background-remnant evidence (real R01 module, no mocks).
const getPageOutputBlockers = (points: TranslatedBubble[], target: string) => scanBlockers(points, { targetId: target, policyVersion: acceptedReview("", "").policyVersion! }, cleanedBackground(), "src-1");
const getUnconfirmedPages: typeof scanPages = (pages, confirmed, cleaning, points, indices, signatures, options) => scanPages(pages, confirmed, new Map(pages.map(p => [p.url, cleaning.get(p.url) ?? {cleanUrl:"clean",regions:[]} as never])), points, indices, signatures, { ...options, sourceRevisions: options?.sourceRevisions ?? new Map(pages.map(p => [p.url, "src-1"])), backgroundInspections: options?.backgroundInspections ?? new Map(pages.map(p => [p.url, cleanedBackground()])) });
const SIZE = 32;
const inkedPlane = () => {
  const data = new Uint8Array(SIZE * SIZE).fill(255);
  for (let y = 8; y < 16; y += 1) for (let x = 8; x < 16; x += 1) data[y * SIZE + x] = 0;
  return { width: SIZE, height: SIZE, data };
};
const blankPlane = () => ({ width: SIZE, height: SIZE, data: new Uint8Array(SIZE * SIZE).fill(255) });
const remnantRevisions = { sourceRevision: "src-1", backgroundRevision: "bg-1", removalRevision: "rm-1" };
const removalRegions = [{ id: "reg-1", rect: { x: 6, y: 6, width: 12, height: 12 }, status: "ready" as const }];
const inspectedRemnant = () =>
  inspectBackgroundRemnants({
    revisions: remnantRevisions,
    originalPlane: inkedPlane(),
    cleanPlane: inkedPlane(),
    removalRegions,
  });
const cleanedBackground = () =>
  inspectBackgroundRemnants({
    revisions: remnantRevisions,
    originalPlane: inkedPlane(),
    cleanPlane: blankPlane(),
    removalRegions,
  });

/** A page whose only problem is the given background inspection (clean verified text, confirmed page). */
const backgroundOnlyPage = (inspection: ReturnType<typeof inspectedRemnant>) => {
  const url = "bg-page";
  return getUnconfirmedPages(
    [page(url)],
    new Set([url]),
    new Map(),
    bubbles(url, [cleanVerified()]),
    undefined,
    new Map([[url, "clean"]]),
    { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]), backgroundInspections: new Map([[url, inspection]]) },
  );
};

// ── Deterministic script failures ───────────────────────────────────────────

describe("G04 shared export eligibility gate", () => {
  it("allows export only when an explicit unreviewed-export override is supplied", () => {
    const url = "p1";
    const pages = [page(url)];
    const confirmations = new Set([url]);
    const points = bubbles(url, [oldAcceptedContaminated()]);
    expect(getUnconfirmedPages(pages, confirmations, new Map(), points, undefined, undefined,
      { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) })).toHaveLength(1);
    expect(getUnconfirmedPages(pages, confirmations, new Map(), points, undefined, undefined,
      { allowUnreviewedExport: true })).toEqual([]);
  });

  it("requires absent background evidence and rejects old saved policy", () => {
    expect(scanBlockers([cleanVerified()], { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }).backgroundBlocked).toBe(true);
    const result = getUnconfirmedPages([page("old")], new Set(["old"]), new Map(), bubbles("old", [cleanVerified()]), undefined, undefined, { targetIdentities: new Map([["old", { targetId: "th", policyVersion: "old" }]]) });
    expect(result[0]?.targetUnconfirmed).toBe(true);
  });
  it("blocks a deterministic script failure even with an old accepted snapshot, page confirmation and a fresh omission signature", () => {
    const url = "p1";
    const result = getUnconfirmedPages(
      [page(url)],
      new Set([url]), // generic page confirmation already recorded
      new Map(),
      bubbles(url, [oldAcceptedContaminated()]),
      undefined,
      new Map([[url, "clean"]]), // omission signature acknowledged
      { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pageUrl: url, scriptIssueCount: 1, hasHardBlockers: true });
  });

  it("cannot bypass a script failure through a dismissed state either", () => {
    const url = "p1";
    const dismissedBubble: TranslatedBubble = {
      ...oldAcceptedContaminated(),
      translationReview: withReviewIdentity({ status: "dismissed", sourceText: "Wait.", reviewedText: "รอก่อนא" }, "th"),
    };
    const result = getUnconfirmedPages(
      [page(url)],
      new Set([url]),
      new Map(),
      bubbles(url, [dismissedBubble]),
      undefined,
      undefined,
      { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(result[0]?.scriptIssueCount).toBe(1);
    expect(result[0]?.hasHardBlockers).toBe(true);
  });

  it("reports the raw blockers so publication paths can gate without the full page scan", () => {
    const blockers = getPageOutputBlockers([oldAcceptedContaminated()], "th");
    expect(blockers).toEqual({ targetUnconfirmed: false, scriptIssueCount: 1, unverifiedReviewCount: 0, backgroundBlocked: false });
    expect(getPageOutputBlockers([cleanVerified()], "th")).toMatchObject({ scriptIssueCount: 0, unverifiedReviewCount: 0 });
  });

  // ── Absent/stale review evidence (legacy & manual points) ─────────────────

  it("blocks translated output whose points carry no review evidence, and page confirmation cannot clear it", () => {
    const url = "legacy";
    const confirmed = getUnconfirmedPages(
      [page(url)],
      new Set([url]),
      new Map(),
      bubbles(url, [manualUnverified()]),
      undefined,
      new Map([[url, "clean"]]),
      { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ unverifiedReviewCount: 1, hasHardBlockers: true, scriptIssueCount: 0 });
  });

  it("re-blocks when the accepted snapshot no longer describes the current text", () => {
    const url = "stale";
    const editedBubble: TranslatedBubble = {
      ...cleanVerified(),
      t: "รอก่อนนะ", // text edited after the snapshot was recorded
    };
    const result = getUnconfirmedPages(
      [page(url)], new Set([url]), new Map(), bubbles(url, [editedBubble]), undefined,
      new Map([[url, "clean"]]),
      { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(result[0]?.unverifiedReviewCount).toBe(1);
    expect(result[0]?.hasHardBlockers).toBe(true);
  });

  it("resolves unverified points through explicit per-point confirmation and ignores revision-only bumps (G03 carry)", () => {
    const url = "confirm";
    // confirmPointReview binds the post-bump page revision; the gate must not
    // staleness-check against a sourceRevision, only against exact text/source/target.
    const confirmedBubble: TranslatedBubble = {
      box: [0, 0, 100, 100],
      t: "พิมพ์เอง",
      original_text: "Typed.",
      translationReview: {
        ...acceptedReview("Typed.", "พิมพ์เอง"),
        sourceRevision: "src-1",
      },
    };
    const result = getUnconfirmedPages(
      [page(url)], new Set(), new Map(), bubbles(url, [confirmedBubble]), undefined,
      undefined,
      { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(result).toEqual([]);
  });

  it("excludes deleted and empty points from every eligibility check", () => {
    const url = "deleted";
    const result = getUnconfirmedPages(
      [page(url)], new Set(), new Map(),
      bubbles(url, [
        { ...oldAcceptedContaminated(), deleted: true },
        { ...manualUnverified(), t: "" },
      ]),
      undefined, undefined,
      { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(result).toEqual([]);
  });

  // ── Target identity ───────────────────────────────────────────────────────

  it("blocks pages with translated text whose target identity is unconfirmed, until the target is confirmed", () => {
    const url = "legacy-target";
    const unconfirmed = getUnconfirmedPages(
      [page(url)], new Set(), new Map(), bubbles(url, [cleanVerified()]),
      undefined, undefined, { targetIdentities: new Map([[url, undefined]]) },
    );
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]).toMatchObject({ targetUnconfirmed: true, hasHardBlockers: true });
    // After the one-time legacy confirmation the page passes (review evidence is current).
    const confirmed = getUnconfirmedPages(
      [page(url)], new Set(), new Map(), bubbles(url, [cleanVerified()]),
      undefined, undefined, { targetIdentities: new Map([[url, { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(confirmed).toEqual([]);
  });

  it("does not demand a target for pages without any translated text", () => {
    const url = "blank";
    const result = getUnconfirmedPages(
      [page(url)], new Set(), new Map(), new Map(), undefined, undefined,
      { targetIdentities: new Map([[url, undefined]]) },
    );
    expect(result).toEqual([]);
  });

  // ── Background-remnant boundary (R01), decoupled from generated-text approval ──

  it("blocks export on an unresolved background-remnant finding even though the page and every point are confirmed", () => {
    expect(backgroundEligibilityState(inspectedRemnant())).toBe("unresolved");
    const result = backgroundOnlyPage(inspectedRemnant());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ backgroundBlocked: true, hasHardBlockers: true, scriptIssueCount: 0, unverifiedReviewCount: 0 });
  });

  it("blocks on unavailable background evidence instead of trusting the page", () => {
    const missingClean = inspectBackgroundRemnants({
      revisions: remnantRevisions,
      originalPlane: inkedPlane(),
      removalRegions,
    });
    expect(backgroundEligibilityState(missingClean)).toBe("unavailable");
    expect(backgroundOnlyPage(missingClean)[0]?.backgroundBlocked).toBe(true);
  });

  it("passes a verified or human-confirmed background and keeps the boundary independent of text approval", () => {
    expect(backgroundEligibilityState(cleanedBackground())).toBe("approved");
    expect(backgroundOnlyPage(cleanedBackground())).toEqual([]);
    const inspected = inspectedRemnant();
    const confirmedResult = applyArtworkConfirmations(
      inspected,
      [confirmCandidateArtwork(inspected, inspected.candidates[0].id)!],
    );
    expect(backgroundEligibilityState(confirmedResult)).toBe("human-confirmed");
    expect(backgroundOnlyPage(confirmedResult)).toEqual([]);
  });

  // ── Explicit substitution / exclusion ─────────────────────────────────────

  it("lets an explicit original-image substitution and an explicit exclusion skip the translated gate", () => {
    const original = page("sub", { exportSource: "original" });
    const excluded = page("exc", { exportExcluded: true });
    const result = getUnconfirmedPages(
      [original, excluded], new Set(), new Map(),
      bubbles("sub", [oldAcceptedContaminated()]),
      undefined, undefined,
      { targetIdentities: new Map([["sub", { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }], ["exc", { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(result).toEqual([]);
  });

  it("keeps listed pages in export order", () => {
    const result = getUnconfirmedPages(
      [page("a"), page("b"), page("c")], new Set(), new Map(),
      bubbles("a", [oldAcceptedContaminated()]),
      undefined, undefined,
      { targetIdentities: new Map([["a", { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }], ["b", { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }], ["c", { targetId: "th", policyVersion: acceptedReview("", "").policyVersion! }]]) },
    );
    expect(result.map(row => row.pageUrl)).toEqual(["a"]);
  });
});

it("G04 does not omit control-only lettering or stale source bindings", () => {
 const point = {...cleanVerified(), t:"\u000b", translationReview: acceptedReview("Wait.", "\u000b")};
 expect(getPageOutputBlockers([point], "th").scriptIssueCount).toBe(1);
 expect(scanBlockers([cleanVerified()], {targetId:"th",policyVersion:acceptedReview("", "").policyVersion!},cleanedBackground(),"other-source").unverifiedReviewCount).toBe(1);
});
