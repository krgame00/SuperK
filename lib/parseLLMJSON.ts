/**
 * Parse LLM JSON output that may contain markdown fences, commentary/preamble,
 * trailing commas, truncated closing braces, or trailing garbage text.
 * Returns the parsed object, or null when nothing parses.
 */
export function parseLLMJSON(text: string): unknown {
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

function sanitizeControlCharsInStrings(str: string): string {
  let inString = false;
  let escaped = false;
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      result += char;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    if (inString) {
      if (char === "\n") {
        result += "\\n";
        continue;
      }
      if (char === "\r") {
        result += "\\r";
        continue;
      }
      if (char === "\t") {
        result += "\\t";
        continue;
      }
    }
    result += char;
  }
  return result;
}

function tryParseCandidates(raw: string): unknown {
  if (!raw) return null;
  const noTrailingCommas = raw.replace(/,\s*([\]}])/g, "$1");
  const sanitized = sanitizeControlCharsInStrings(raw);
  const sanitizedNoCommas = sanitizeControlCharsInStrings(noTrailingCommas);

  const candidates: string[] = [raw, noTrailingCommas, sanitized, sanitizedNoCommas];

  const lastBrace = noTrailingCommas.lastIndexOf("}");
  if (lastBrace !== -1) {
    candidates.push(noTrailingCommas.substring(0, lastBrace + 1));
    candidates.push(noTrailingCommas.substring(0, lastBrace + 1) + "]}");
    candidates.push(sanitizedNoCommas.substring(0, lastBrace + 1));
    candidates.push(sanitizedNoCommas.substring(0, lastBrace + 1) + "]}");
  }

  // Truncated tail recovery
  candidates.push(sanitizedNoCommas + "]}");
  candidates.push(sanitizedNoCommas + "\"}]}");
  candidates.push(sanitizedNoCommas + "}");

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