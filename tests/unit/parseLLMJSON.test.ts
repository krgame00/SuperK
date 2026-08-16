import { describe, it, expect } from "vitest";
import { parseLLMJSON } from "@/lib/parseLLMJSON";

describe("parseLLMJSON", () => {
  it("parses plain JSON", () => {
    const result = parseLLMJSON('{"bubbles":[{"t":"สวัสดี"}]}');
    expect(result.bubbles[0].t).toBe("สวัสดี");
  });

  it("strips ```json markdown fences", () => {
    const result = parseLLMJSON('```json\n{"bubbles":[{"t":"เฮ้"}]}\n```');
    expect(result.bubbles[0].t).toBe("เฮ้");
  });

  it("strips plain ``` fences", () => {
    const result = parseLLMJSON('```\n{"bubbles":[{"t":"โฮ"}]}\n```');
    expect(result.bubbles[0].t).toBe("โฮ");
  });

  it("fixes trailing commas", () => {
    const result = parseLLMJSON('{"bubbles":[{"t":"เฮ้",}]}');
    expect(result.bubbles[0].t).toBe("เฮ้");
  });

  it("recovers truncated closing braces", () => {
    const result = parseLLMJSON('{"bubbles":[{"t":"ทดสอบ"}');
    expect(result.bubbles[0].t).toBe("ทดสอบ");
  });

  it("returns null on garbage", () => {
    expect(parseLLMJSON("fdsfafdas")).toBe(null);
  });

  it("returns null on empty string", () => {
    expect(parseLLMJSON("")).toBe(null);
  });
});