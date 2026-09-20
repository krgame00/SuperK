/**
 * SuperK — Bulletproof LLM JSON Parser & Repair Engine
 *
 * Handles common LLM output defects:
 * - Markdown fences (```json ... ``` or unclosed ```json)
 * - Preamble / commentary before and after JSON
 * - Direct array outputs ([{...}] instead of {"bubbles": [...]})
 * - Unescaped quotes inside string values (e.g. "t": "เธอพูดว่า "ไม่นะ" จริงเหรอ")
 * - Truncated JSON streams (token limit / incomplete response)
 * - Trailing commas, single quotes, control characters
 * - Partial chunk recovery when parts of the JSON are corrupted
 * - Conversational "no text found" detection -> { bubbles: [] }
 */

export function parseLLMJSON(text: string): unknown {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 0. Conversational "no text detected" / empty scan heuristics
  if (isExplicitNoTextResponse(trimmed)) {
    return { bubbles: [] };
  }

  // 1. Try markdown code block extraction first: ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const inside = codeBlockMatch[1].trim();
    if (inside) {
      const parsedInside = tryParseWithAllRepairs(inside);
      if (parsedInside) return normalizeParsedOutput(parsedInside);
    }
  }

  // 2. Try parsing between outer braces/brackets
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const lastBrace = trimmed.lastIndexOf("}");
  const lastBracket = trimmed.lastIndexOf("]");

  // Prefer object if first or only
  if (firstBrace !== -1) {
    if (firstBracket === -1 || firstBrace < firstBracket) {
      const end = lastBrace !== -1 && lastBrace >= firstBrace ? lastBrace + 1 : trimmed.length;
      const objectSpan = trimmed.substring(firstBrace, end);
      const parsedObj = tryParseWithAllRepairs(objectSpan);
      if (parsedObj) return normalizeParsedOutput(parsedObj);
    }
  }

  // If array starts before brace (or no brace exists)
  if (firstBracket !== -1) {
    const end = lastBracket !== -1 && lastBracket >= firstBracket ? lastBracket + 1 : trimmed.length;
    const arraySpan = trimmed.substring(firstBracket, end);
    const parsedArr = tryParseWithAllRepairs(arraySpan);
    if (parsedArr) return normalizeParsedOutput(parsedArr);
  }

  // 3. Try raw text with markdown fences stripped
  const base = trimmed.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const parsedBase = tryParseWithAllRepairs(base);
  if (parsedBase) return normalizeParsedOutput(parsedBase);

  // 4. Deep Recovery: Extract individual bubble objects via regex scanner
  const recoveredBubbles = extractIndividualBubbles(trimmed);
  if (recoveredBubbles.length > 0) {
    return { bubbles: recoveredBubbles };
  }

  return null;
}

function normalizeParsedOutput(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    return { bubbles: parsed };
  }
  return parsed;
}

function isExplicitNoTextResponse(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (
    lower === "[]" ||
    lower === "{}" ||
    lower === "none" ||
    lower === "n/a" ||
    lower === "null" ||
    lower === "no text" ||
    lower === "no text found" ||
    lower === "no text detected" ||
    lower === "no text in image" ||
    lower === "no japanese text detected" ||
    lower === "no text to translate" ||
    lower === "ไม่พบข้อความ" ||
    lower === "ไม่มีข้อความ" ||
    lower === "ภาพไม่มีข้อความ"
  ) {
    return true;
  }
  // Conversational sentence with no JSON symbols
  if (
    !text.includes("{") &&
    !text.includes("[") &&
    (
      lower.includes("no text") ||
      lower.includes("no dialogue") ||
      lower.includes("not contain") ||
      lower.includes("cannot find any text") ||
      lower.includes("no readable text") ||
      lower.includes("could not detect any text") ||
      lower.includes("ไม่พบข้อความ") ||
      lower.includes("ไม่มีข้อความ")
    )
  ) {
    return true;
  }
  return false;
}

function tryParseWithAllRepairs(raw: string): unknown {
  if (!raw) return null;

  // Direct fast path
  try {
    const direct = JSON.parse(raw);
    if (direct && (typeof direct === "object" || Array.isArray(direct))) {
      return direct;
    }
  } catch {
    // Continue to repair pipeline
  }

  const variations = generateRepairedCandidates(raw);
  for (const candidate of variations) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && (typeof parsed === "object" || Array.isArray(parsed))) {
        return parsed;
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

function generateRepairedCandidates(raw: string): string[] {
  const candidates: string[] = [];

  // Repair step 1: standard sanitation (trailing commas & control characters)
  const noTrailingCommas = raw.replace(/,\s*([\]}])/g, "$1");
  const sanitized = sanitizeControlCharsInStrings(raw);
  const sanitizedNoCommas = sanitizeControlCharsInStrings(noTrailingCommas);

  candidates.push(noTrailingCommas, sanitized, sanitizedNoCommas);

  // Repair step 2: unescaped quotes inside strings
  const fixedQuotes = repairUnescapedQuotes(sanitizedNoCommas);
  if (fixedQuotes !== sanitizedNoCommas) {
    candidates.push(fixedQuotes);
    candidates.push(sanitizeControlCharsInStrings(fixedQuotes));
  }

  // Repair step 3: single quotes conversion (Python style dicts)
  if (raw.includes("'") && !raw.includes('"')) {
    const singleToDouble = raw
      .replace(/True/g, "true")
      .replace(/False/g, "false")
      .replace(/None/g, "null")
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
    candidates.push(singleToDouble);
  }

  // Repair step 4: balanced bracket completions for truncated responses
  const baseCandidates = [...candidates];
  for (const base of baseCandidates) {
    const balanced = autoBalanceTruncatedJSON(base);
    if (balanced && balanced !== base) {
      candidates.push(balanced);
    }
  }

  return candidates;
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

/**
 * Repairs unescaped double quotes inside JSON string values.
 * Uses a state machine that checks whether a quote is followed by valid JSON delimiters (, } ] :)
 * or if it is an inner quotation inside text.
 */
function repairUnescapedQuotes(jsonStr: string): string {
  let inString = false;
  let escaped = false;
  let result = "";

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

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
      if (!inString) {
        inString = true;
        result += '"';
      } else {
        // We are currently inside a string. Is this `"` the closing quote or an inner quote?
        // Lookahead to check what follows this quote (skipping spaces)
        let nextNonSpaceIdx = i + 1;
        while (nextNonSpaceIdx < jsonStr.length && /\s/.test(jsonStr[nextNonSpaceIdx])) {
          nextNonSpaceIdx++;
        }
        const nextChar = jsonStr[nextNonSpaceIdx];

        // In JSON object/array:
        // A true closing quote must be followed by `,`, `}`, `]`, `:`, or EOF
        if (
          nextChar === "," ||
          nextChar === "}" ||
          nextChar === "]" ||
          nextChar === ":" ||
          nextNonSpaceIdx >= jsonStr.length
        ) {
          inString = false;
          result += '"';
        } else {
          // This quote is followed by non-JSON delimiter -> It's an unescaped inner quote!
          result += '\\"';
        }
      }
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Auto-balances unclosed braces, brackets, and quotes when a response is cut off.
 */
function autoBalanceTruncatedJSON(raw: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") {
          stack.pop();
        }
      } else if (char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") {
          stack.pop();
        }
      }
    }
  }

  let result = raw.trimEnd();

  // If ended with trailing comma, strip it
  result = result.replace(/,\s*$/, "");

  // If string was open, close it
  if (inString) {
    result += '"';
  }

  // Close remaining open containers in reverse order
  while (stack.length > 0) {
    const open = stack.pop();
    result = result.replace(/,\s*$/, "");
    if (open === "{") {
      result += "}";
    } else if (open === "[") {
      result += "]";
    }
  }

  return result;
}

/**
 * Deep recovery: scans text for individual bubble JSON objects and parses each.
 */
function extractIndividualBubbles(text: string): Array<Record<string, unknown>> {
  const bubbles: Array<Record<string, unknown>> = [];
  const objectRegex = /\{[^{}]*(?:"(?:box|box_2d|original_text|t|translation)"[^{}]*)+\}/g;
  const matches = text.match(objectRegex);

  if (!matches) return bubbles;

  for (const match of matches) {
    const parsed = tryParseWithAllRepairs(match);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (
        record.box !== undefined ||
        record.box_2d !== undefined ||
        record.t !== undefined ||
        record.translation !== undefined ||
        record.original_text !== undefined
      ) {
        bubbles.push(record);
      }
    }
  }

  return bubbles;
}