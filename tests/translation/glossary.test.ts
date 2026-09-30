import { describe, expect, it } from "vitest";
import {
  buildGlossaryDirectives,
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
