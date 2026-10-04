import { expect, it } from "vitest";
import {
  BackgroundInspectionCache,
  backgroundEligibilityState,
  confirmCandidateArtwork,
  inspectBackgroundRemnants,
  lumaPlaneFromRgba,
  type BackgroundArtworkConfirmation,
  type BackgroundInspectionResult,
  type GrayscalePlane,
  type RemnantRemovalRegion,
  type RemnantTextEvidence,
} from "@/lib/cleaning/backgroundRemnantInspection";

// Deterministic single-channel fixtures. White 240 page, dark 40 glyph ink.
const PAGE = 240;
const INK = 40;

function makePlane(width: number, height: number, fill = PAGE): GrayscalePlane {
  return { width, height, data: new Uint8Array(width * height).fill(fill) };
}

function fillRect(plane: GrayscalePlane, x: number, y: number, w: number, h: number, value: number): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      if (xx >= 0 && yy >= 0 && xx < plane.width && yy < plane.height) {
        plane.data[yy * plane.width + xx] = value;
      }
    }
  }
}

/** Thin diagonal strokes: short horizontal runs, low coverage — hatching-like. */
function drawDiagonalHatch(plane: GrayscalePlane, x: number, y: number, size: number, gap = 4): void {
  for (let d = 0; d < size * 2; d += gap) {
    for (let i = 0; i < size; i += 1) {
      const px = x + i;
      const py = y + ((d + i) % size);
      if (px < plane.width && py < plane.height) plane.data[py * plane.width + px] = INK;
    }
  }
}

function copyPlane(plane: GrayscalePlane): GrayscalePlane {
  return { width: plane.width, height: plane.height, data: new Uint8Array(plane.data) };
}

function region(id: string, rect: RemnantRemovalRegion["rect"], overrides: Partial<RemnantRemovalRegion> = {}): RemnantRemovalRegion {
  return { id, rect, status: "ready", ...overrides };
}

function textBox(id: string, ymin: number, xmin: number, ymax: number, xmax: number): RemnantTextEvidence {
  return { id, box: [ymin, xmin, ymax, xmax] };
}

const REVISIONS = { sourceRevision: "src-1", backgroundRevision: "bg-1", removalRevision: "mask-1" };

function openStates(result: BackgroundInspectionResult): string[] {
  return result.candidates.filter(c => c.state !== "human-confirmed-artwork").map(c => c.state);
}

it("flags a full glyph remnant left inside an attempted removal region", () => {
  const original = makePlane(64, 64);
  fillRect(original, 20, 24, 20, 10, INK);
  const clean = copyPlane(original); // nothing was actually removed
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 16, y: 20, width: 28, height: 18 })],
  });
  expect(result.status).toBe("inspected");
  expect(openStates(result)).toEqual(["suspected-remnant"]);
  const candidate = result.candidates[0];
  expect(candidate.detail).toBe("full-glyph");
  expect(candidate.evidence.removalRegionIds).toEqual(["r1"]);
  expect(candidate.confidence).toBeGreaterThan(0.5);
  expect(backgroundEligibilityState(result)).toBe("unresolved");
});

it("flags a partial glyph remnant instead of dismissing small leftovers", () => {
  const original = makePlane(64, 64);
  fillRect(original, 20, 24, 20, 10, INK);
  const clean = copyPlane(original);
  fillRect(clean, 20, 24, 15, 10, PAGE); // only the left 3/4 was removed
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 16, y: 20, width: 28, height: 18 })],
  });
  expect(openStates(result)).toEqual(["suspected-remnant"]);
  expect(result.candidates[0].detail).toBe("partial-glyph");
  expect(result.candidates[0].evidence.survivingInkPixels).toBe(50);
  expect(backgroundEligibilityState(result)).toBe("unresolved");
});

it("reports a genuinely clean page when all evidence ink was removed", () => {
  const original = makePlane(64, 64);
  fillRect(original, 20, 24, 20, 10, INK);
  const clean = makePlane(64, 64);
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 16, y: 20, width: 28, height: 18 })],
    textEvidence: [textBox("t1", 375, 312, 531, 687)], // same area, no translated pixels composited
  });
  expect(result.status).toBe("inspected");
  expect(result.candidates).toEqual([]);
  expect(backgroundEligibilityState(result)).toBe("approved");
});

it("keeps untouched text without removal authorization as an unchanged review candidate", () => {
  const original = makePlane(128, 128);
  fillRect(original, 60, 60, 10, 8, INK);
  const clean = copyPlane(original);
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    textEvidence: [textBox("t1", 400, 400, 600, 600)],
  });
  expect(result.status).toBe("inspected");
  expect(openStates(result)).toEqual(["unchanged-candidate"]);
  expect(result.candidates[0].evidence.textEvidenceIds).toEqual(["t1"]);
  expect(result.candidates[0].evidence.removalRegionIds).toEqual([]);
  expect(backgroundEligibilityState(result)).toBe("unresolved");
});

it("never writes to the inspected image planes", () => {
  const original = makePlane(64, 64);
  fillRect(original, 20, 24, 20, 10, INK);
  const clean = copyPlane(original);
  const originalSnapshot = new Uint8Array(original.data);
  const cleanSnapshot = new Uint8Array(clean.data);
  inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 16, y: 20, width: 28, height: 18 })],
  });
  expect(Array.from(original.data)).toEqual(Array.from(originalSnapshot));
  expect(Array.from(clean.data)).toEqual(Array.from(cleanSnapshot));
});

it("downgrades hatching-like surviving strokes to uncertain review findings", () => {
  const original = makePlane(64, 64);
  drawDiagonalHatch(original, 24, 24, 16);
  const clean = copyPlane(original); // hatching was never part of a glyph removal
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 20, y: 20, width: 24, height: 24 })],
  });
  expect(result.status).toBe("inspected");
  expect(openStates(result)).toEqual(["uncertain"]);
  expect(result.candidates[0].detail).toBe("line-like");
  expect(result.candidates[0].confidence).toBeLessThanOrEqual(0.35);
  // Uncertain stays a review finding; it is never silently dismissed.
  expect(backgroundEligibilityState(result)).toBe("unresolved");
});

it("never reports artwork outside the bounded evidence areas", () => {
  const original = makePlane(96, 96);
  drawDiagonalHatch(original, 70, 70, 20); // decorative art, far from any evidence
  fillRect(original, 10, 10, 8, 8, INK);
  const clean = makePlane(96, 96); // removal region fully cleaned
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 6, y: 6, width: 16, height: 16 })],
  });
  expect(result.status).toBe("inspected");
  expect(result.candidates).toEqual([]);
  expect(backgroundEligibilityState(result)).toBe("approved");
});

it("keeps source ink in preserved/protected regions unresolved until exact artwork confirmation", () => {
  const original = makePlane(64, 64);
  fillRect(original, 20, 24, 20, 10, INK);
  const clean = copyPlane(original);
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 16, y: 20, width: 28, height: 18 }, { status: "preserved", textRole: "protected" })],
  });
  expect(result.status).toBe("inspected");
  expect(result.candidates[0]?.state).toBe("unchanged-candidate");
  expect(backgroundEligibilityState(result)).toBe("unresolved");
});

it("marks missing original evidence as unverified and never clean", () => {
  const clean = makePlane(64, 64);
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 0, y: 0, width: 8, height: 8 })],
  });
  expect(result.status).toBe("unverified");
  expect(result.unverifiedReason).toBe("missing-original");
  expect(result.candidates).toEqual([]);
  expect(backgroundEligibilityState(result)).toBe("unavailable");
});

it("marks missing clean evidence as unverified and never clean", () => {
  const original = makePlane(64, 64);
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
  });
  expect(result.status).toBe("unverified");
  expect(result.unverifiedReason).toBe("missing-clean");
  expect(backgroundEligibilityState(result)).toBe("unavailable");
});

it("marks mismatched plane dimensions as unverified", () => {
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: makePlane(64, 64),
    cleanPlane: makePlane(32, 32),
    removalRegions: [region("r1", { x: 0, y: 0, width: 8, height: 8 })],
  });
  expect(result.status).toBe("unverified");
  expect(result.unverifiedReason).toBe("dimension-mismatch");
  expect(backgroundEligibilityState(result)).toBe("unavailable");
});

it("records detection failure as unverified instead of a silent pass", () => {
  const broken = makePlane(16, 16);
  const corrupted = { ...broken, width: 32 }; // declared dims no longer match data length
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: corrupted,
    cleanPlane: { ...broken, width: 32 },
    removalRegions: [region("r1", { x: 0, y: 0, width: 8, height: 8 })],
  });
  expect(result.status).toBe("unverified");
  expect(result.unverifiedReason).toBe("detection-failed");
  expect(result.unverifiedDetail).toBeTruthy();
  expect(backgroundEligibilityState(result)).toBe("unavailable");
});

it("refuses to label a page clean when no removal or text evidence bounds the search", () => {
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: makePlane(64, 64),
    cleanPlane: makePlane(64, 64),
  });
  expect(result.status).toBe("unverified");
  expect(result.unverifiedReason).toBe("no-removal-evidence");
  expect(backgroundEligibilityState(result)).toBe("unavailable");
});

it("treats unbindable revision identities as unverified evidence", () => {
  const result = inspectBackgroundRemnants({
    revisions: { sourceRevision: "", backgroundRevision: "bg-1", removalRevision: "mask-1" },
    originalPlane: makePlane(8, 8),
    cleanPlane: makePlane(8, 8),
    removalRegions: [region("r1", { x: 0, y: 0, width: 4, height: 4 })],
  });
  expect(result.status).toBe("unverified");
  expect(result.unverifiedReason).toBe("missing-revisions");
  expect(backgroundEligibilityState(result)).toBe("unavailable");
});

it("binds cached reuse to exact source, background and removal revisions", () => {
  const cache = new BackgroundInspectionCache(4);
  const original = makePlane(64, 64);
  fillRect(original, 20, 24, 20, 10, INK);
  const clean = makePlane(64, 64);
  const input = {
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 16, y: 20, width: 28, height: 18 })],
  };
  const first = cache.inspect(input);
  // Unchanged assets: identical cached result object, no recomputation.
  expect(cache.inspect(input)).toBe(first);
  // Any revision identity change invalidates the cached evidence.
  for (const revisions of [
    { ...REVISIONS, sourceRevision: "src-2" },
    { ...REVISIONS, backgroundRevision: "bg-2" },
    { ...REVISIONS, removalRevision: "mask-2" },
  ]) {
    const next = cache.inspect({ ...input, revisions });
    expect(next).not.toBe(first);
    expect(next.revisionKey).not.toBe(first.revisionKey);
  }
});

it("evicts least-recently-used inspection results beyond the cache bound", () => {
  const cache = new BackgroundInspectionCache(2);
  const input = {
    revisions: REVISIONS,
    originalPlane: makePlane(64, 64),
    cleanPlane: makePlane(64, 64),
    removalRegions: [region("r1", { x: 0, y: 0, width: 8, height: 8 })],
  };
  const first = cache.inspect(input);
  cache.inspect({ ...input, revisions: { ...REVISIONS, backgroundRevision: "bg-2" } });
  cache.inspect({ ...input, revisions: { ...REVISIONS, backgroundRevision: "bg-3" } });
  const reRun = cache.inspect(input);
  expect(reRun).not.toBe(first);
  expect(reRun.revisionKey).toBe(first.revisionKey);
});

it("scopes artwork confirmation to the exact candidate and revision", () => {
  const cache = new BackgroundInspectionCache(4);
  const original = makePlane(96, 64);
  fillRect(original, 8, 24, 12, 10, INK);
  fillRect(original, 60, 24, 12, 10, INK);
  const clean = copyPlane(original);
  const input = {
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 4, y: 20, width: 20, height: 18 }), region("r2", { x: 56, y: 20, width: 20, height: 18 })],
  };
  const first = cache.inspect(input);
  expect(openStates(first)).toEqual(["suspected-remnant", "suspected-remnant"]);
  const confirmation = confirmCandidateArtwork(first, first.candidates[0].id);
  expect(confirmation).toBeDefined();
  expect(confirmCandidateArtwork(first, "does-not-exist")).toBeUndefined();
  const resolved = cache.inspect({ ...input, artworkConfirmations: [confirmation as BackgroundArtworkConfirmation] });
  expect(resolved.candidates.find(c => c.id === first.candidates[0].id)?.state).toBe("human-confirmed-artwork");
  expect(openStates(resolved)).toEqual(["suspected-remnant"]);
  expect(backgroundEligibilityState(resolved)).toBe("unresolved");
  // A changed background revision invalidates the old confirmation.
  const recleaned = cache.inspect({
    ...input,
    revisions: { ...REVISIONS, backgroundRevision: "bg-2" },
    artworkConfirmations: [confirmation as BackgroundArtworkConfirmation],
  });
  expect(openStates(recleaned)).toEqual(["suspected-remnant", "suspected-remnant"]);
  expect(backgroundEligibilityState(recleaned)).toBe("unresolved");
});

it("maps fully human-confirmed pages to the human-confirmed eligibility state", () => {
  const original = makePlane(64, 64);
  fillRect(original, 20, 24, 20, 10, INK);
  const clean = copyPlane(original);
  const input = {
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 16, y: 20, width: 28, height: 18 })],
  };
  const first = inspectBackgroundRemnants(input);
  const confirmation = confirmCandidateArtwork(first, first.candidates[0].id) as BackgroundArtworkConfirmation;
  const resolved = inspectBackgroundRemnants({ ...input, artworkConfirmations: [confirmation] });
  expect(openStates(resolved)).toEqual([]);
  expect(backgroundEligibilityState(resolved)).toBe("human-confirmed");
});

it("exposes candidate locations in page pixels and 0-1000 overlay boxes", () => {
  const original = makePlane(200, 100);
  fillRect(original, 50, 20, 50, 30, INK);
  const clean = copyPlane(original);
  const result = inspectBackgroundRemnants({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: clean,
    removalRegions: [region("r1", { x: 50, y: 20, width: 50, height: 30 })],
  });
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].rect).toEqual({ x: 50, y: 20, width: 50, height: 30 });
  expect(result.candidates[0].box).toEqual([200, 250, 500, 500]);
});

it("converts RGBA pixels to a luma plane with white compositing", () => {
  const rgba = new Uint8Array([
    255, 0, 0, 255, // red -> ~76
    0, 255, 0, 255, // green -> ~150
    30, 30, 30, 0,  // transparent -> composited over white
  ]);
  const plane = lumaPlaneFromRgba(rgba, 3, 1);
  expect(plane.width).toBe(3);
  expect(plane.height).toBe(1);
  expect(plane.data[0]).toBe(76);
  expect(plane.data[1]).toBe(150);
  expect(plane.data[2]).toBe(255);
});

it("never caches unverified inspection results", () => {
  const cache = new BackgroundInspectionCache(2);
  const unverified = cache.inspect({
    revisions: REVISIONS,
    cleanPlane: makePlane(8, 8),
    removalRegions: [region("r1", { x: 0, y: 0, width: 8, height: 8 })],
  });
  expect(unverified.status).toBe("unverified");
  // The original becoming available with the same revision identity must
  // actually run detection instead of replaying the stale unverified result.
  const original = makePlane(8, 8);
  fillRect(original, 0, 0, 4, 4, INK);
  const inspected = cache.inspect({
    revisions: REVISIONS,
    originalPlane: original,
    cleanPlane: makePlane(8, 8),
    removalRegions: [region("r1", { x: 0, y: 0, width: 8, height: 8 })],
  });
  expect(inspected.status).toBe("inspected");
  expect(inspected).not.toBe(unverified);
});

it("invalidate drops the cached result so the exact revision is re-inspected", () => {
  const cache = new BackgroundInspectionCache(2);
  const input = {
    revisions: REVISIONS,
    originalPlane: makePlane(8, 8),
    cleanPlane: makePlane(8, 8),
    removalRegions: [region("r1", { x: 0, y: 0, width: 8, height: 8 })],
  };
  const first = cache.inspect(input);
  expect(cache.inspect(input)).toBe(first);
  cache.invalidate(REVISIONS);
  const reRun = cache.inspect(input);
  expect(reRun).not.toBe(first);
  expect(reRun.revisionKey).toBe(first.revisionKey);
});
