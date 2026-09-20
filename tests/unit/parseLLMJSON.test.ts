import { describe, it, expect } from "vitest";
import { parseLLMJSON } from "@/lib/parseLLMJSON";

interface TestResult {
  bubbles: Array<{ t?: string; box?: number[] }>;
}

/** parseLLMJSON returns `unknown` — tests assert on the expected shape. */
function parseAsResult(text: string): TestResult {
  return parseLLMJSON(text) as TestResult;
}

describe("parseLLMJSON", () => {
  it("parses plain JSON", () => {
    const result = parseAsResult('{"bubbles":[{"t":"สวัสดี"}]}');
    expect(result.bubbles[0].t).toBe("สวัสดี");
  });

  it("strips ```json markdown fences", () => {
    const result = parseAsResult('```json\n{"bubbles":[{"t":"เฮ้"}]}\n```');
    expect(result.bubbles[0].t).toBe("เฮ้");
  });

  it("handles preamble commentary before markdown fences", () => {
    const result = parseLLMJSON('Image solid green. No text in image. JSON return empty.\n\n```json\n{\n  "bubbles": []\n}\n```');
    expect(result).toEqual({ bubbles: [] });
  });

  it("handles conversational preamble before raw JSON", () => {
    const result = parseAsResult('Here is the translation:\n{\n  "bubbles": [{"t":"สวัสดี"}]\n}\nHope this helps!');
    expect(result.bubbles[0].t).toBe("สวัสดี");
  });

  it("strips plain ``` fences", () => {
    const result = parseAsResult('```\n{"bubbles":[{"t":"โฮ"}]}\n```');
    expect(result.bubbles[0].t).toBe("โฮ");
  });

  it("fixes trailing commas", () => {
    const result = parseAsResult('{"bubbles":[{"t":"เฮ้",}]}');
    expect(result.bubbles[0].t).toBe("เฮ้");
  });

  it("recovers truncated closing braces", () => {
    const result = parseAsResult('{"bubbles":[{"t":"ทดสอบ"}');
    expect(result.bubbles[0].t).toBe("ทดสอบ");
  });

  it("handles unescaped literal newlines inside string values", () => {
    const result = parseAsResult('{"bubbles":[{"t":"บรรทัดที่ 1\nบรรทัดที่ 2"}]}');
    expect(result.bubbles[0].t).toBe("บรรทัดที่ 1\nบรรทัดที่ 2");
  });

  it("handles direct array output by wrapping into bubbles object", () => {
    const result = parseAsResult('[{"t":"บทพูดข้อความ","box":[100,200,300,400]}]');
    expect(result.bubbles).toBeDefined();
    expect(result.bubbles[0].t).toBe("บทพูดข้อความ");
  });

  it("handles direct array output with conversational prefix", () => {
    const result = parseAsResult('Translation output: [{"t":"สวัสดีครับ","box":[50,50,150,150]}]');
    expect(result.bubbles).toBeDefined();
    expect(result.bubbles[0].t).toBe("สวัสดีครับ");
  });

  it("repairs unescaped double quotes inside translation strings", () => {
    const result = parseAsResult('{"bubbles":[{"t":"เธอพูดว่า "ไม่นะ" จริงเหรอ"}]}');
    expect(result.bubbles[0].t).toContain("ไม่นะ");
  });

  it("recovers severely truncated responses with multiple open brackets", () => {
    const result = parseAsResult('{"bubbles":[{"t":"ประโยคแรก","box":[10,20,30,40]},{"t":"ประโยคสอง');
    expect(result.bubbles.length).toBeGreaterThanOrEqual(1);
    expect(result.bubbles[0].t).toBe("ประโยคแรก");
  });

  it("parses single-quoted Python style dict output", () => {
    const result = parseAsResult("{'bubbles': [{'t': 'สวัสดีครับ'}]}");
    expect(result.bubbles[0].t).toBe("สวัสดีครับ");
  });

  it("detects conversational 'no text found' sentences and returns empty bubbles instead of crashing", () => {
    expect(parseLLMJSON("No text found in this image.")).toEqual({ bubbles: [] });
    expect(parseLLMJSON("The image does not contain any readable text.")).toEqual({ bubbles: [] });
    expect(parseLLMJSON("ภาพนี้ไม่มีข้อความ")).toEqual({ bubbles: [] });
  });

  it("recovers individual bubbles when middle is corrupted by garbage text", () => {
    const corrupted = '{"bubbles":[{"t":"กล่อง 1","box":[10,20,30,40]}, CORRUPTED_GARBAGE_ERROR, {"t":"กล่อง 2","box":[50,60,70,80]}]}';
    const result = parseAsResult(corrupted);
    expect(result.bubbles.length).toBe(2);
    expect(result.bubbles[0].t).toBe("กล่อง 1");
    expect(result.bubbles[1].t).toBe("กล่อง 2");
  });

  it("returns null on garbage", () => {
    expect(parseLLMJSON("fdsfafdas")).toBe(null);
  });

  it("returns null on empty string", () => {
    expect(parseLLMJSON("")).toBe(null);
  });
});
