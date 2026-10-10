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
