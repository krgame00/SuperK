/**
 * Parse LLM JSON output that may contain markdown fences, commentary/preamble,
 * trailing commas, truncated closing braces, or trailing garbage text.
 * Returns the parsed object, or null when nothing parses.
 */
export function parseLLMJSON(text: string): any {
  if (!text) return null;

  // 1. Try markdown code block extraction first: ```json ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const inside = codeBlockMatch[1].trim();
    const parsedInside = tryParseCandidates(inside);
    if (parsedInside) return parsedInside;
  }

  // 2. Extract substring between the first '{' and the last '}'
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    const jsonSpan = text.substring(firstBrace, lastBrace + 1);
    const parsedSpan = tryParseCandidates(jsonSpan);
    if (parsedSpan) return parsedSpan;
  }

  // 3. Fallback to raw text stripping markdown tags
  const base = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return tryParseCandidates(base);
}

function tryParseCandidates(raw: string): any {
  if (!raw) return null;
  const noTrailingCommas = raw.replace(/,\s*([\]}])/g, "$1");

  const candidates: string[] = [raw, noTrailingCommas];

  const lastBrace = noTrailingCommas.lastIndexOf("}");
  if (lastBrace !== -1) {
    candidates.push(noTrailingCommas.substring(0, lastBrace + 1));
    candidates.push(noTrailingCommas.substring(0, lastBrace + 1) + "]}");
  }

  const trimmedTail = noTrailingCommas.replace(/[^}]*$/, "");
  if (trimmedTail && trimmedTail !== noTrailingCommas) {
    candidates.push(trimmedTail);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}