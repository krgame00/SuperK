/**
 * Parse LLM JSON output that may contain markdown fences, trailing commas,
 * truncated closing braces, or trailing garbage text.
 * Returns the parsed object, or null when nothing parses.
 */
export function parseLLMJSON(text: string): any {
  if (!text) return null;

  const base = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const noTrailingCommas = base.replace(/,\s*([\]}])/g, "$1");

  const candidates: string[] = [base, noTrailingCommas];

  // Model truncated the JSON: cut at the last } and re-close array.
  const lastBrace = noTrailingCommas.lastIndexOf("}");
  if (lastBrace !== -1) {
    candidates.push(noTrailingCommas.substring(0, lastBrace + 1) + "]}");
  }

  // Model appended explanation text after the JSON: strip everything after the last }.
  const trimmedTail = noTrailingCommas.replace(/[^}]*$/, "");
  if (trimmedTail !== noTrailingCommas) {
    candidates.push(trimmedTail);
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return null;
}