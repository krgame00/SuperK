import { describe, expect, it } from "vitest";
import {
  buildGlossaryDirectives,
  mergeGlossaryEntries,
  type GlossaryEntry,
} from "@/lib/translation/glossary";

describe("buildGlossaryDirectives", () => {
  it("returns empty string for null, undefined, or empty array", () => {
    expect(buildGlossaryDirectives(null)).toBe("");
    expect(buildGlossaryDirectives(undefined)).toBe("");
    expect(buildGlossaryDirectives([])).toBe("");
  });

  it("filters out invalid or empty entries", () => {
    const entries: GlossaryEntry[] = [
      { source: "", target: "ลูฟี่" },
      { source: "Zoro", target: "" },
      { source: "  ", target: "   " },
    ];
    expect(buildGlossaryDirectives(entries)).toBe("");
  });

  it("formats valid glossary entries into mandatory AI directives", () => {
    const entries: GlossaryEntry[] = [
      { source: "Luffy", target: "ลูฟี่", note: "กัปตันเรือ" },
      { source: "Zoro", target: "โซโล" },
      { source: "Ore", target: "ฉัน" },
    ];

    const result = buildGlossaryDirectives(entries);
    expect(result).toContain("GLOSSARY & CHARACTER NAME LOCK");
    expect(result).toContain('- "Luffy" MUST ALWAYS be translated as "ลูฟี่" (กัปตันเรือ)');
    expect(result).toContain('- "Zoro" MUST ALWAYS be translated as "โซโล"');
    expect(result).toContain('- "Ore" MUST ALWAYS be translated as "ฉัน"');
  });
});

describe("mergeGlossaryEntries", () => {
  it("returns incoming valid entries when existing is empty or null", () => {
    const incoming: GlossaryEntry[] = [
      { source: "ナミ", target: "นามิ" },
      { source: "ゾロ", target: "โซโล" },
    ];
    const { merged, addedCount, updatedCount } = mergeGlossaryEntries(null, incoming);
    expect(addedCount).toBe(2);
    expect(updatedCount).toBe(0);
    expect(merged).toEqual([
      { source: "ナミ", target: "นามิ", note: undefined },
      { source: "ゾロ", target: "โซโล", note: undefined },
    ]);
  });

  it("merges new incoming entries while preserving existing custom entries", () => {
    const existing: GlossaryEntry[] = [
      { source: "ルフィ", target: "ลูฟี่", note: "เพิ่มมือ" },
    ];
    const incoming: GlossaryEntry[] = [
      { source: "ナミ", target: "นามิ" },
      { source: "ゾロ", target: "โซโล" },
    ];
    const { merged, addedCount, updatedCount } = mergeGlossaryEntries(existing, incoming);
    expect(addedCount).toBe(2);
    expect(updatedCount).toBe(0);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ source: "ルフィ", target: "ลูฟี่", note: "เพิ่มมือ" });
    expect(merged[1]).toEqual({ source: "ナミ", target: "นามิ", note: undefined });
    expect(merged[2]).toEqual({ source: "ゾロ", target: "โซโล", note: undefined });
  });

  it("updates existing target and note when incoming has matching source", () => {
    const existing: GlossaryEntry[] = [
      { source: "ルフィ", target: "ลูฟี่เดิม", note: "โน้ตเดิม" },
      { source: "サンジ", target: "ซันจิ" },
    ];
    const incoming: GlossaryEntry[] = [
      { source: "ルフィ", target: "มังกี้ ดี ลูฟี่", note: "โน้ตใหม่" },
      { source: "チョッパー", target: "ช็อปเปอร์" },
    ];
    const { merged, addedCount, updatedCount } = mergeGlossaryEntries(existing, incoming);
    expect(addedCount).toBe(1);
    expect(updatedCount).toBe(1);
    expect(merged).toHaveLength(3);
    expect(merged.find((e) => e.source === "ルフィ")).toEqual({
      source: "ルフィ",
      target: "มังกี้ ดี ลูฟี่",
      note: "โน้ตใหม่",
    });
    expect(merged.find((e) => e.source === "サンジ")).toEqual({
      source: "サンジ",
      target: "ซันจิ",
      note: undefined,
    });
  });

  it("filters out empty or invalid items gracefully", () => {
    const existing: GlossaryEntry[] = [{ source: "A", target: "เอ" }];
    const incoming = [
      { source: "", target: "บี" },
      { source: "C", target: "   " },
      null,
      { source: "  D  ", target: "  ดี  " },
    ] as any;
    const { merged, addedCount } = mergeGlossaryEntries(existing, incoming);
    expect(addedCount).toBe(1);
    expect(merged).toEqual([
      { source: "A", target: "เอ", note: undefined },
      { source: "D", target: "ดี", note: undefined },
    ]);
  });
});

it("a non-string note cannot crash prompt building", () => {
  const directives = buildGlossaryDirectives([
    { source: "Luffy", target: "ลูฟี่", note: 42 as unknown as string },
    { source: "Zoro", target: "โซโร", note: { bad: "object" } as unknown as string },
    { source: "Nami", target: "นามิ", note: "สมจริง" },
  ]);

  expect(directives).toContain('- "Luffy" MUST ALWAYS be translated as "ลูฟี่"');
  expect(directives).toContain('- "Zoro" MUST ALWAYS be translated as "โซโร"');
  expect(directives).toContain('- "Nami" MUST ALWAYS be translated as "นามิ" (สมจริง)');
  expect(directives).not.toContain("42");
});

it("formats character persona attributes into prompt directives (WP-4.5)", () => {
  const directives = buildGlossaryDirectives([
    {
      source: "田中",
      target: "ทานากะ",
      note: "พระเอก",
      persona: {
        selfPronoun: "กู",
        otherPronoun: "มึง",
        particleTone: "ว่ะ",
      },
    },
    {
      source: "鈴木",
      target: "ซูซูกิ",
      persona: {
        selfPronoun: "ฉัน",
        particleTone: "จ๊ะ",
      },
    },
  ]);

  expect(directives).toContain(
    '- "田中" MUST ALWAYS be translated as "ทานากะ" [Persona: สรรพนามแทนตัว: "กู", สรรพนามเรียกผู้อื่น: "มึง", หางเสียง/น้ำเสียง: "ว่ะ"] (พระเอก)',
  );
  expect(directives).toContain(
    '- "鈴木" MUST ALWAYS be translated as "ซูซูกิ" [Persona: สรรพนามแทนตัว: "ฉัน", หางเสียง/น้ำเสียง: "จ๊ะ"]',
  );
});

it("merges and preserves persona fields across incoming updates", () => {
  const existing: GlossaryEntry[] = [
    {
      source: "田中",
      target: "ทานากะ",
      persona: { selfPronoun: "ฉัน", otherPronoun: "นาย" },
    },
  ];
  const incoming = [
    {
      source: "田中",
      target: "ทานากะ",
      persona: { selfPronoun: "กู", otherPronoun: "มึง", particleTone: "ว่ะ" },
    },
    {
      source: "佐藤",
      target: "ซาโต้",
      persona: { particleTone: "ครับ" },
    },
  ];

  const { merged, addedCount, updatedCount } = mergeGlossaryEntries(existing, incoming);
  expect(addedCount).toBe(1);
  expect(updatedCount).toBe(1);
  expect(merged[0].persona).toEqual({
    selfPronoun: "กู",
    otherPronoun: "มึง",
    particleTone: "ว่ะ",
  });
  expect(merged[1].persona).toEqual({
    particleTone: "ครับ",
  });
});
