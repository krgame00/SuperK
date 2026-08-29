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
