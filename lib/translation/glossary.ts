export interface GlossaryEntry {
  source: string;
  target: string;
  note?: string;
}

export function buildGlossaryDirectives(glossary?: GlossaryEntry[] | null): string {
  if (!glossary || !Array.isArray(glossary) || glossary.length === 0) {
    return "";
  }

  const validEntries = glossary.filter(
    (entry) =>
      entry &&
      typeof entry.source === "string" &&
      entry.source.trim().length > 0 &&
      typeof entry.target === "string" &&
      entry.target.trim().length > 0,
  );

  if (validEntries.length === 0) return "";

  const lines = validEntries.map((entry) => {
    const src = entry.source.trim();
    const tgt = entry.target.trim();
    // Notes arrive from user-edited storage — a non-string (number, object)
    // must be dropped, not crash the whole translation request.
    const note =
      typeof entry.note === "string" ? entry.note.trim() || undefined : undefined;
    return `- "${src}" MUST ALWAYS be translated as "${tgt}"${note ? ` (${note})` : ""}`;
  });

  return (
    `\nGLOSSARY & CHARACTER NAME LOCK (MANDATORY - DO NOT ALTER):\n` +
    lines.join("\n") +
    `\n`
  );
}
