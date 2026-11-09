import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  extractGlossaryCandidatesFromBubbles,
  mergeGlossaryEntries,
  type GlossaryEntry,
} from "@/lib/translation/glossary";

describe("Auto-Learn Character Glossary Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts character candidates with Japanese honorifics (先生, さん, etc.)", () => {
    const bubbles = [
      { original_text: "ルフィ先生、待ってください！", t: "อาจารย์ลูฟี่ รอก่อนสิครับ!" },
      { original_text: "ナミさん、行くぞ！", t: "คุณนามิ ไปกันเถอะ!" },
      { original_text: "普通のセリフです", t: "เป็นบทพูดธรรมดาครับ" },
    ];

    const candidates = extractGlossaryCandidatesFromBubbles(bubbles, []);
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const sources = candidates.map((c) => c.source);
    expect(sources.some((s) => s.includes("先生") || s.includes("ルフィ"))).toBe(true);
  });

  it("merges newly learned character candidates into existing glossary without duplicating", () => {
    const existing: GlossaryEntry[] = [
      { source: "ルフィ", target: "ลูฟี่", note: "กัปตัน" },
    ];

    const newCandidates: GlossaryEntry[] = [
      { source: "ルフィ", target: "ลูฟี่", note: "เดิม" },
      { source: "ゾロ", target: "โซโล", note: "นักดาบ" },
    ];

    const { merged, addedCount, updatedCount } = mergeGlossaryEntries(existing, newCandidates);
    expect(addedCount).toBe(1);
    expect(updatedCount).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.source === "ゾロ")?.target).toBe("โซโล");
  });

  it("ignores bubbles marked as deleted", () => {
    const bubbles = [
      { original_text: "シャンクス様！", t: "ท่านแชงคูส!", deleted: true },
    ];

    const candidates = extractGlossaryCandidatesFromBubbles(bubbles, []);
    expect(candidates).toHaveLength(0);
  });
});
