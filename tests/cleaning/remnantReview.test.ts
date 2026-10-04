import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyArtworkConfirmations,
  backgroundEligibilityState,
  confirmCandidateArtwork,
  inspectBackgroundRemnants,
  type BackgroundArtworkConfirmation,
  type GrayscalePlane,
} from "@/lib/cleaning/backgroundRemnantInspection";
import {
  RemnantConfirmationStore,
  blobFingerprint,
  decodeLumaPlane,
  findRegionForCandidate,
  inspectCleanedPage,
  remnantRevisions,
} from "@/lib/cleaning/remnantReview";
import { authorizationIdentity } from "@/lib/cleaning/textAuthorization";
import type { CleaningRegion } from "@/lib/cleaning/types";
import { createPageTargetIdentity, inspectPageOutputEligibility } from "@/lib/translation/pageEligibility";

it("rejects truncated RGBA from the actual decoder", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 8, height: 8, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(4) }) } as unknown as CanvasRenderingContext2D);
  expect(await decodeLumaPlane(new Blob(["bad"]))).toBeUndefined();
});

it("production fingerprints distinguish different bytes with the same size and type", async () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    const first = new Blob(["abc"], { type: "image/png" });
    const second = new Blob(["def"], { type: "image/png" });
    expect(await blobFingerprint(first)).not.toBe(await blobFingerprint(second));
    expect(await blobFingerprint(first)).toBe(await blobFingerprint(first));
  } finally { vi.unstubAllEnvs(); }
});

// Deterministic fixtures: white 240 page, dark 40 glyph ink, 64x64 planes.
const PAGE = 240;
const INK = 40;
const SIZE = 64;

function solidRgba(width: number, height: number, gray: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = gray;
    data[i * 4 + 1] = gray;
    data[i * 4 + 2] = gray;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function fillRectRgba(data: Uint8ClampedArray, width: number, x: number, y: number, w: number, h: number, gray: number): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const offset = (yy * width + xx) * 4;
      data[offset] = gray;
      data[offset + 1] = gray;
      data[offset + 2] = gray;
      data[offset + 3] = 255;
    }
  }
}

/** Original page fixture: white page with one glyph block left uncleaned. */
function originalRgba(): Uint8ClampedArray {
  const data = solidRgba(SIZE, SIZE, PAGE);
  fillRectRgba(data, SIZE, 20, 24, 20, 10, INK);
  return data;
}

/** Decoders are stubbed at createImageBitmap/canvas level, keyed by blob size.
 *  Every fixture content gets a unique padding so blob sizes never collide
 *  (test-mode fingerprints are size-based; production hashes content). */
const FIXTURE_ORIGINAL_SIZE = SIZE * SIZE * 4 + 16;
const FIXTURE_UNCLEANED_CLEAN_SIZE = SIZE * SIZE * 4 + 8;
const FIXTURE_CLEANED_CLEAN_SIZE = SIZE * SIZE * 4;
let decodeFailures = 0;

function stubImageDecoding(): void {
  const fixtures = new Map<number, { width: number; height: number; rgba: Uint8ClampedArray }>([
    [FIXTURE_ORIGINAL_SIZE, { width: SIZE, height: SIZE, rgba: originalRgba() }],
    [FIXTURE_UNCLEANED_CLEAN_SIZE, { width: SIZE, height: SIZE, rgba: originalRgba() }],
    [FIXTURE_CLEANED_CLEAN_SIZE, { width: SIZE, height: SIZE, rgba: solidRgba(SIZE, SIZE, PAGE) }],
  ]);
  let drawn: Uint8ClampedArray = new Uint8ClampedArray();
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => {
    const fixture = fixtures.get(blob.size);
    if (!fixture) throw new Error(`no decode fixture for blob size ${blob.size}`);
    return { width: fixture.width, height: fixture.height, rgba: fixture.rgba, close: vi.fn() };
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
    if (decodeFailures > 0) {
      decodeFailures -= 1;
      return null;
    }
    return {
      drawImage: vi.fn((image: { rgba: Uint8ClampedArray }) => { drawn = image.rgba; }),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) =>
        new ImageData(new Uint8ClampedArray(drawn), w, h)),
    } as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
}

function originalBlob(): Blob {
  return new Blob([new Uint8ClampedArray(originalRgba()), new Uint8Array(16)], { type: "image/png" });
}

function uncleanedCleanBlob(): Blob {
  return new Blob([new Uint8ClampedArray(originalRgba()), new Uint8Array(8)], { type: "image/png" });
}

function cleanedCleanBlob(): Blob {
  return new Blob([new Uint8ClampedArray(solidRgba(SIZE, SIZE, PAGE))], { type: "image/png" });
}

function makeRegion(id: string, overrides: Partial<CleaningRegion> = {}): CleaningRegion {
  return {
    id,
    rect: { x: 16, y: 20, width: 28, height: 18 },
    route: "flat",
    confidence: 0.9,
    status: "ready",
    residualScore: 0,
    damageScore: 0,
    pageRole: "comic",
    textRole: "dialogue",
    eligibilityConfidence: 0.8,
    automaticAction: "clean",
    protectionReasons: [],
    ...overrides,
  };
}

const REVISIONS = { sourceRevision: "src-1", backgroundRevision: "bg-1", removalRevision: "mask-1" };

function makePlane(width: number, height: number, fill = PAGE): GrayscalePlane {
  return { width, height, data: new Uint8Array(width * height).fill(fill) };
}

function fillRect(plane: GrayscalePlane, x: number, y: number, w: number, h: number, value: number): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      plane.data[yy * plane.width + xx] = value;
    }
  }
}

afterEach(() => {
  decodeFailures = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("remnantRevisions", () => {
  it("leaves missing mask identity unbindable", async () => {
    const revisions = await remnantRevisions({ sourceFingerprint: "src", regions: [makeRegion("r")], cleanBlob: cleanedCleanBlob() });
    expect(revisions.removalRevision).toBe("");
  });
  it("binds stored cleaning identities to exact source/background/removal revisions", async () => {
    const regions = [makeRegion("region-1")];
    const revisions = await remnantRevisions({
      sourceFingerprint: "src-abc",
      maskFingerprint: "mask-abc",
      regions,
      cleanBlob: cleanedCleanBlob(),
    });
    expect(revisions).toBeDefined();
    expect(revisions?.sourceRevision).toBe("src-abc");
    // The clean asset's exact bytes are the background identity; a changed
    // clean asset must change the identity.
    const backgroundRevision = revisions?.backgroundRevision ?? "";
    expect(backgroundRevision.length).toBeGreaterThan(0);
    const otherClean = await remnantRevisions({
      sourceFingerprint: "src-abc",
      maskFingerprint: "mask-abc",
      regions,
      cleanBlob: uncleanedCleanBlob(),
    });
    expect(otherClean?.backgroundRevision).not.toBe(backgroundRevision);
    expect(revisions?.removalRevision).toBe(`mask:mask-abc:auth:${authorizationIdentity(regions)}`);
  });

  it("keeps removal authorization text confirmations inside the removal revision", async () => {
    const plain = [makeRegion("region-1")];
    const confirmed = [makeRegion("region-1", { textConfirmed: true })];
    const base = await remnantRevisions({ sourceFingerprint: "s", maskFingerprint: "m", regions: plain, cleanBlob: cleanedCleanBlob() });
    const approved = await remnantRevisions({ sourceFingerprint: "s", maskFingerprint: "m", regions: confirmed, cleanBlob: cleanedCleanBlob() });
    expect(approved?.removalRevision).not.toBe(base?.removalRevision);
  });
});

describe("inspectCleanedPage", () => {
  it("flags surviving original ink on a real cleaned page and stays unresolved", async () => {
    stubImageDecoding();
    const result = await inspectCleanedPage({
      result: {
        sourceFingerprint: "src-1",
        maskFingerprint: "mask-1",
        regions: [makeRegion("region-1")],
        cleanBlob: uncleanedCleanBlob(),
      },
      sourceBlob: originalBlob(),
    });
    expect(result.status).toBe("inspected");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].state).toBe("suspected-remnant");
    expect(result.candidates[0].rect).toEqual({ x: 20, y: 24, width: 20, height: 10 });
    expect(backgroundEligibilityState(result)).toBe("unresolved");
  });

  it("reports an actually-cleaned page as approved without findings", async () => {
    stubImageDecoding();
    const result = await inspectCleanedPage({
      result: {
        sourceFingerprint: "src-1",
        maskFingerprint: "mask-1",
        regions: [makeRegion("region-1")],
        cleanBlob: cleanedCleanBlob(),
      },
      sourceBlob: originalBlob(),
    });
    expect(result.status).toBe("inspected");
    expect(result.candidates).toEqual([]);
    expect(backgroundEligibilityState(result)).toBe("approved");
  });

  it("marks a missing original page as unverified, never clean", async () => {
    const result = await inspectCleanedPage({
      result: {
        sourceFingerprint: "src-1",
        maskFingerprint: "mask-1",
        regions: [makeRegion("region-1")],
        cleanBlob: cleanedCleanBlob(),
      },
    });
    expect(result.status).toBe("unverified");
    expect(result.unverifiedReason).toBe("missing-original");
    expect(backgroundEligibilityState(result)).toBe("unavailable");
  });

  it("marks missing stored fingerprints as unbindable unverified evidence", async () => {
    const result = await inspectCleanedPage({
      result: {
        regions: [makeRegion("region-1")],
        cleanBlob: cleanedCleanBlob(),
      },
      sourceBlob: originalBlob(),
    });
    expect(result.status).toBe("unverified");
    expect(result.unverifiedReason).toBe("missing-revisions");
    expect(backgroundEligibilityState(result)).toBe("unavailable");
  });

  it("records image decode failure as unverified instead of a silent pass", async () => {
    stubImageDecoding();
    decodeFailures = 1; // first decode attempt fails (the original page)
    const result = await inspectCleanedPage({
      result: {
        sourceFingerprint: "src-1",
        maskFingerprint: "mask-1",
        regions: [makeRegion("region-1")],
        cleanBlob: uncleanedCleanBlob(),
      },
      sourceBlob: originalBlob(),
    });
    expect(result.status).toBe("unverified");
    expect(result.unverifiedReason).toBe("detection-failed");
    expect(backgroundEligibilityState(result)).toBe("unavailable");
  });

  it("reuses cached inspected results for identical revisions and applies confirmations on top", async () => {
    stubImageDecoding();
    const input = {
      result: {
        sourceFingerprint: "src-1",
        maskFingerprint: "mask-1",
        regions: [makeRegion("region-1")],
        cleanBlob: uncleanedCleanBlob(),
      },
      sourceBlob: originalBlob(),
    };
    const first = await inspectCleanedPage(input);
    const second = await inspectCleanedPage(input);
    expect(second).toBe(first);
    const confirmation = confirmCandidateArtwork(first, first.candidates[0].id);
    expect(confirmation).toBeDefined();
    const resolved = await inspectCleanedPage({ ...input, confirmations: [confirmation as BackgroundArtworkConfirmation] });
    expect(resolved).not.toBe(first);
    expect(resolved.candidates[0].state).toBe("human-confirmed-artwork");
    expect(backgroundEligibilityState(resolved)).toBe("human-confirmed");
  });
});

describe("RemnantConfirmationStore", () => {
  it("keeps a confirmation restorable on Undo and absent on a Redo to a different revision", () => {
    const store = new RemnantConfirmationStore();
    store.confirm("page-1", { candidateId: "rem-1", revisionKey: "rev-A" });
    // "Redo" to a newer revision: nothing binds there.
    expect(store.confirmationsForRevision("page-1", "rev-B")).toEqual([]);
    // "Undo" back to the exact revision: the confirmation is still valid and restores.
    expect(store.confirmationsForRevision("page-1", "rev-A")).toEqual([{ candidateId: "rem-1", revisionKey: "rev-A" }]);
  });

  it("deduplicates confirmations for the same candidate and revision", () => {
    const store = new RemnantConfirmationStore();
    store.confirm("p", { candidateId: "rem-1", revisionKey: "rev-A" });
    store.confirm("p", { candidateId: "rem-1", revisionKey: "rev-A" });
    expect(store.confirmationsForRevision("p", "rev-A")).toHaveLength(1);
  });

  it("keeps confirmations for separate revisions independent", () => {
    const store = new RemnantConfirmationStore();
    store.confirm("p", { candidateId: "rem-1", revisionKey: "rev-A" });
    store.confirm("p", { candidateId: "rem-2", revisionKey: "rev-B" });
    expect(store.allForPage("p")).toHaveLength(2);
    expect(store.confirmationsForRevision("p", "rev-A")).toEqual([{ candidateId: "rem-1", revisionKey: "rev-A" }]);
    expect(store.confirmationsForRevision("p", "rev-B")).toEqual([{ candidateId: "rem-2", revisionKey: "rev-B" }]);
  });

  it("bounds stored revisions per page and evicts the least recently used", () => {
    const store = new RemnantConfirmationStore();
    for (let i = 0; i < 10; i += 1) {
      store.confirm("p", { candidateId: `rem-${i}`, revisionKey: `rev-${i}` });
    }
    expect(store.confirmationsForRevision("p", "rev-0")).toEqual([]);
    expect(store.confirmationsForRevision("p", "rev-9")).toEqual([{ candidateId: "rem-9", revisionKey: "rev-9" }]);
  });

  it("replaces a page's confirmations from persisted metadata", () => {
    const store = new RemnantConfirmationStore();
    store.replacePage("p", [
      { candidateId: "rem-1", revisionKey: "rev-A" },
      { candidateId: "rem-1", revisionKey: "rev-A" },
      { candidateId: "rem-2", revisionKey: "rev-B" },
    ]);
    expect(store.confirmationsForRevision("p", "rev-A")).toEqual([{ candidateId: "rem-1", revisionKey: "rev-A" }]);
    expect(store.confirmationsForRevision("p", "rev-B")).toEqual([{ candidateId: "rem-2", revisionKey: "rev-B" }]);
  });

  it("invalidates the whole page on source replacement", () => {
    const store = new RemnantConfirmationStore();
    store.confirm("p", { candidateId: "rem-1", revisionKey: "rev-A" });
    store.invalidatePage("p");
    expect(store.allForPage("p")).toEqual([]);
    expect(store.confirmationsForRevision("p", "rev-A")).toEqual([]);
  });
});

describe("findRegionForCandidate", () => {
  const regions = [
    makeRegion("region-1", { rect: { x: 0, y: 0, width: 20, height: 20 } }),
    makeRegion("region-2", { rect: { x: 30, y: 0, width: 20, height: 20 } }),
  ];

  it("selects the authorized removal region with the largest overlap", () => {
    expect(findRegionForCandidate(regions, { x: 32, y: 4, width: 4, height: 4 })?.id).toBe("region-2");
    expect(findRegionForCandidate(regions, { x: 2, y: 4, width: 4, height: 4 })?.id).toBe("region-1");
  });

  it("returns undefined when a candidate lies outside every authorized region", () => {
    expect(findRegionForCandidate(regions, { x: 60, y: 60, width: 4, height: 4 })).toBeUndefined();
  });
});

describe("combined output eligibility boundary", () => {
  it("never lets a human artwork confirmation override generated-text script failure", async () => {
    const original = makePlane(64, 64);
    fillRect(original, 20, 24, 20, 10, INK);
    const clean = { width: 64, height: 64, data: new Uint8Array(original.data) };
    const raw = inspectBackgroundRemnants({
      revisions: REVISIONS,
      originalPlane: original,
      cleanPlane: clean,
      removalRegions: [{ id: "r1", rect: { x: 16, y: 20, width: 28, height: 18 }, status: "ready" }],
    });
    const confirmation = confirmCandidateArtwork(raw, raw.candidates[0].id) as BackgroundArtworkConfirmation;
    const confirmed = applyArtworkConfirmations(raw, [confirmation]);
    expect(confirmed.candidates[0].state).toBe("human-confirmed-artwork");
    expect(backgroundEligibilityState(confirmed)).toBe("human-confirmed");

    const eligibility = inspectPageOutputEligibility({
      targetIdentity: createPageTargetIdentity("th"),
      points: [{ id: "p1", text: "กAา" }],
      backgroundState: backgroundEligibilityState(confirmed),
      backgroundRevision: raw.revisionKey,
    });
    expect(eligibility.status).toBe("blocked");
    expect(eligibility.reasons).toContain("script-violation");
  });

  it("never lets translation approval resolve an unreviewed background finding", async () => {
    const eligibility = inspectPageOutputEligibility({
      targetIdentity: createPageTargetIdentity("th"),
      points: [{ id: "p1", text: "สวัสดี" }],
      contextualState: "approved",
      backgroundState: "unresolved",
    });
    expect(eligibility.status).toBe("blocked");
    expect(eligibility.scriptStatus).toBe("eligible");
    expect(eligibility.reasons).toContain("background-review-required");
  });

  it("maps unverified background evidence to blocked output instead of a silent pass", async () => {
    const result = await inspectCleanedPage({
      result: {
        sourceFingerprint: "src-1",
        maskFingerprint: "mask-1",
        regions: [makeRegion("region-1")],
        cleanBlob: cleanedCleanBlob(),
      },
    });
    expect(result.status).toBe("unverified");
    const eligibility = inspectPageOutputEligibility({
      targetIdentity: createPageTargetIdentity("th"),
      points: [{ id: "p1", text: "สวัสดี" }],
      contextualState: "approved",
      backgroundState: backgroundEligibilityState(result),
    });
    expect(eligibility.status).toBe("blocked");
    expect(eligibility.reasons).toContain("background-review-required");
  });
});
