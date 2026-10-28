export interface GlossaryEntry {
  source: string;
  target: string;
  note?: string;
}

export type FlexibleGlossaryEntry =
  | GlossaryEntry
  | {
      source?: string;
      target?: string;
      original?: string;
      translation?: string;
      note?: string;
    };

export function buildGlossaryDirectives(
  glossary?: FlexibleGlossaryEntry[] | null,
): string {
  if (!glossary || !Array.isArray(glossary) || glossary.length === 0) {
    return "";
  }

  const validEntries = glossary
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const rawSource =
        typeof candidate.source === "string" && candidate.source.trim().length > 0
          ? candidate.source
          : typeof candidate.original === "string" && candidate.original.trim().length > 0
            ? candidate.original
            : "";
      const rawTarget =
        typeof candidate.target === "string" && candidate.target.trim().length > 0
          ? candidate.target
          : typeof candidate.translation === "string" && candidate.translation.trim().length > 0
            ? candidate.translation
            : "";
      if (!rawSource || !rawTarget) return null;
      // Notes arrive from user-edited storage — a non-string (number, object)
      // must be dropped, not crash the whole translation request.
      const note =
        typeof candidate.note === "string"
          ? candidate.note.trim() || undefined
          : undefined;
      return { src: rawSource.trim(), tgt: rawTarget.trim(), note };
    })
    .filter(
      (entry): entry is { src: string; tgt: string; note: string | undefined } =>
        entry !== null,
    );

  if (validEntries.length === 0) return "";

  const lines = validEntries.map(
    ({ src, tgt, note }) =>
      `- "${src}" MUST ALWAYS be translated as "${tgt}"${note ? ` (${note})` : ""}`,
  );

  return (
    `\nGLOSSARY & CHARACTER NAME LOCK (MANDATORY - DO NOT ALTER):\n` +
    lines.join("\n") +
    `\n`
  );
}

export function extractGlossaryCandidatesFromBubbles(
  bubbles: Array<{
    original_text?: string;
    t?: string;
    translated?: string;
    deleted?: boolean;
  }>,
  existingGlossary?: FlexibleGlossaryEntry[] | null,
): GlossaryEntry[] {
  if (!Array.isArray(bubbles) || bubbles.length === 0) return [];

  const existingSources = new Set<string>();
  for (const item of existingGlossary ?? []) {
    if (!item || typeof item !== "object") continue;
    const raw = (item as Record<string, unknown>).source ?? (item as Record<string, unknown>).original;
    if (typeof raw === "string" && raw.trim()) {
      existingSources.add(raw.trim().toLowerCase());
    }
  }

  const pairCounts = new Map<string, { source: string; target: string; count: number; isHonorificOrName: boolean }>();
  const honorificOrNamePattern = /(?:さん|くん|ちゃん|様|先生|先輩|殿|님|씨|-san|-kun|-chan|-sama|-sensei|\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b)/;

  for (const b of bubbles) {
    if (!b || b.deleted) continue;
    const rawSrc = typeof b.original_text === "string" ? b.original_text.trim() : "";
    const rawTgt = typeof b.t === "string" && b.t.trim() ? b.t.trim() : typeof b.translated === "string" ? b.translated.trim() : "";
    if (!rawSrc || !rawTgt) continue;

    // Clean surrounding punctuation for candidate matching
    const cleanSrc = rawSrc.replace(/^[\s"'“”‘’([\]!?.…~-]+|[\s"'“”‘’)\]!?.…~-]+$/g, "").trim();
    const cleanTgt = rawTgt.replace(/^[\s"'“”‘’([\]!?.…~-]+|[\s"'“”‘’)\]!?.…~-]+$/g, "").trim();
    if (cleanSrc.length < 2 || cleanSrc.length > 28) continue;
    if (cleanTgt.length < 2 || cleanTgt.length > 35) continue;
    if (existingSources.has(cleanSrc.toLowerCase())) continue;

    const key = cleanSrc.toLowerCase();
    const isHonorificOrName = honorificOrNamePattern.test(cleanSrc);
    const existing = pairCounts.get(key);
    if (existing) {
      existing.count += 1;
      if (isHonorificOrName) existing.isHonorificOrName = true;
    } else {
      pairCounts.set(key, {
        source: cleanSrc,
        target: cleanTgt,
        count: 1,
        isHonorificOrName,
      });
    }
  }

  const results: GlossaryEntry[] = [];
  for (const item of pairCounts.values()) {
    if (item.count >= 2 || (item.isHonorificOrName && item.source.length <= 22)) {
      results.push({
        source: item.source,
        target: item.target,
        note: item.count >= 2 ? `พบบ่อย (${item.count} ครั้ง)` : "ชื่อเฉพาะ/คำเรียก",
      });
    }
  }

  return results.slice(0, 30);
}

export function mergeGlossaryEntries(
  existing: FlexibleGlossaryEntry[] | null | undefined,
  incoming: FlexibleGlossaryEntry[] | null | undefined,
): { merged: GlossaryEntry[]; addedCount: number; updatedCount: number } {
  const merged: GlossaryEntry[] = [];
  const sourceIndexMap = new Map<string, number>();

  const normalize = (entry: unknown): GlossaryEntry | null => {
    if (!entry || typeof entry !== "object") return null;
    const c = entry as Record<string, unknown>;
    const rawSource =
      typeof c.source === "string" && c.source.trim().length > 0
        ? c.source
        : typeof c.original === "string" && c.original.trim().length > 0
          ? c.original
          : typeof c.src === "string" && c.src.trim().length > 0
            ? c.src
            : "";
    const rawTarget =
      typeof c.target === "string" && c.target.trim().length > 0
        ? c.target
        : typeof c.translation === "string" && c.translation.trim().length > 0
          ? c.translation
          : typeof c.dst === "string" && c.dst.trim().length > 0
            ? c.dst
            : "";
    if (!rawSource || !rawTarget) return null;
    const note =
      typeof c.note === "string" && c.note.trim().length > 0
        ? c.note.trim()
        : undefined;
    return { source: rawSource.trim(), target: rawTarget.trim(), note };
  };

  for (const item of existing ?? []) {
    const valid = normalize(item);
    if (!valid) continue;
    const key = valid.source.toLowerCase();
    if (sourceIndexMap.has(key)) {
      merged[sourceIndexMap.get(key)!] = valid;
    } else {
      sourceIndexMap.set(key, merged.length);
      merged.push(valid);
    }
  }

  let addedCount = 0;
  let updatedCount = 0;

  for (const item of incoming ?? []) {
    const valid = normalize(item);
    if (!valid) continue;
    const key = valid.source.toLowerCase();
    if (sourceIndexMap.has(key)) {
      const idx = sourceIndexMap.get(key)!;
      const prev = merged[idx];
      merged[idx] = {
        source: valid.source,
        target: valid.target,
        note: valid.note !== undefined ? valid.note : prev.note,
      };
      updatedCount += 1;
    } else {
      sourceIndexMap.set(key, merged.length);
      merged.push(valid);
      addedCount += 1;
    }
  }

  return { merged, addedCount, updatedCount };
}
