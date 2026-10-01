import { beforeEach, describe, expect, it, vi } from "vitest";
import { needsSourceOutlineRefresh, refreshSourceOutline } from "@/lib/colorMatching/outlineMigration";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import type { TextStyleProfile } from "@/lib/colorMatching/types";
import type { TranslatedBubble } from "@/lib/translationOverlay";

vi.mock("@/lib/colorMatching/sampleTextColors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/colorMatching/sampleTextColors")>(), extractTextColors: vi.fn(),
}));
const version = "source-outline-v1";
const legacy: TextStyleProfile = {
  source: "auto", ownershipMode: "auto", evidenceState: "admitted", fillConfidence: .95,
  fill: "#159f9d", outline: "#ffffff", hasOutline: true, outlineWidth: 1, outlineWidthRatio: .13,
  fillGradient: { angleDeg: 90, stops: [{ offset: 0, color: "#159f9d" }, { offset: 1, color: "#004488" }] },
  opacity: .7, category: "sfx", shadow: { color: "#111111", opacity: .8, blurRatio: .1, offsetXRatio: .1, offsetYRatio: .1 },
};
const bubble = (overrides: Partial<TextStyleProfile> = {}): TranslatedBubble => ({
  box: [10, 10, 900, 900], t: "translation", styleProfile: { ...legacy, ...overrides },
});
const sample = { width: 20, height: 20, rgba: new Uint8ClampedArray(1600) };
beforeEach(() => {
  vi.mocked(extractTextColors).mockReturnValue({ ...legacy, fill: "#169e9d", fillGradient: undefined,
    outline: "#000000", hasOutline: false, outlineWidth: 0, outlineWidthRatio: 0,
    outlineConfidence: .93, sourceOutlineVersion: version });
});
describe("legacy source outline migration", () => {
  it("rejects an outline recovered around a materially different source fill", () => {
    vi.mocked(extractTextColors).mockReturnValue({ ...legacy, fill: "#cc0000", hasOutline: false,
      outlineWidth: 0, outlineWidthRatio: 0, sourceOutlineVersion: version });
    const old = bubble();
    expect(refreshSourceOutline(old, sample)).toBe(old);
    expect(old.styleProfile?.sourceOutlineVersion).toBeUndefined();
  });
  it.each(["auto", "source_faithful"] as const)("refreshes %s outline while preserving fill and user settings", (ownershipMode) => {
    const old = bubble({ ownershipMode });
    const updated = refreshSourceOutline(old, sample);
    expect(updated).not.toBe(old);
    expect(updated.styleProfile).toEqual({ ...old.styleProfile, outline: "#000000", hasOutline: false,
      outlineWidth: 0, outlineWidthRatio: 0, outlineConfidence: .93, sourceOutlineVersion: version });
    expect(old.styleProfile?.hasOutline).toBe(true);
  });
  it.each([{ source: "manual" }, { ownershipMode: "manual" }, { ownershipMode: "readable" },
    { sourceOutlineVersion: version }, { sourceOutlineVersion: "source-outline-future" },
    { evidenceState: "rejected" }, { fillConfidence: .5 } ] as Partial<TextStyleProfile>[])("preserves ineligible profile %j", (overrides) => {
    const old = bubble(overrides);
    expect(needsSourceOutlineRefresh(old)).toBe(false);
    expect(refreshSourceOutline(old, sample)).toBe(old);
  });
  it("allows explicitly Original profiles with medium fill confidence", () => {
    expect(needsSourceOutlineRefresh(bubble({ ownershipMode: "source_faithful", fillConfidence: .7 }))).toBe(true);
  });
  it.each([null, { width: 0, height: 0, rgba: new Uint8ClampedArray() }])("retains failed samples without stamping success", (failedSample) => {
    const old = bubble();
    expect(refreshSourceOutline(old, failedSample)).toBe(old);
  });
  it.each(["rejected", "unverified"] as const)("retains %s extraction without stamping success", (evidenceState) => {
    vi.mocked(extractTextColors).mockReturnValue({ ...legacy, evidenceState, sourceOutlineVersion: version });
    const old = bubble();
    expect(refreshSourceOutline(old, sample)).toBe(old);
  });
});
