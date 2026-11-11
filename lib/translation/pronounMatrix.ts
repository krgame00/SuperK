export interface PronounRelation {
  id?: string;
  speaker: string;
  listener: string;
  firstPerson: string;
  secondPerson: string;
  forbiddenPronouns?: string[];
  forbiddenHonorifics?: string[];
  note?: string;
}

export interface PronounPreset {
  label: string;
  description: string;
  firstPerson: string;
  secondPerson: string;
  note: string;
}

export const COMMON_PRONOUN_PRESETS: PronounPreset[] = [
  {
    label: "เพื่อนสนิท (ฉัน / นาย)",
    description: "ภาษาวัยรุ่นทั่วไป สนิทสนม เป็นกันเอง",
    firstPerson: "ฉัน",
    secondPerson: "นาย",
    note: "เพื่อนสนิท พูดจาเป็นกันเอง",
  },
  {
    label: "เพื่อนผู้หญิง / คู่รัก (ฉัน / เธอ)",
    description: "สุภาพ นุ่มนวล ระหว่างเพื่อนหรือคู่พระนาง",
    firstPerson: "ฉัน",
    secondPerson: "เธอ",
    note: "อ่อนโยน สนิทสนม",
  },
  {
    label: "ทางการ / ให้เกียรติ (ผม / คุณ)",
    description: "ทำงาน สุภาพ ให้เกียรติ",
    firstPerson: "ผม",
    secondPerson: "คุณ",
    note: "สุภาพ ทางการ ให้เกียรติ",
  },
  {
    label: "ย้อนยุค / โบราณ (ข้า / เจ้า)",
    description: "แนวแฟนตาซี จีนโบราณ หรืออัศวินยุคกลาง",
    firstPerson: "ข้า",
    secondPerson: "เจ้า",
    note: "ย้อนยุค โบราณ ขึงขัง",
  },
  {
    label: "พี่น้อง (พี่ / เธอ)",
    description: "พี่พูดกับน้องสาวหรือน้องชาย",
    firstPerson: "พี่",
    secondPerson: "เธอ",
    note: "พี่พูดกับน้อง",
  },
  {
    label: "กวนๆ / สนิทมาก (เรา / แก)",
    description: "เพื่อนซี้สายฮา คุยสบายๆ",
    firstPerson: "เรา",
    secondPerson: "แก",
    note: "เพื่อนสนิทสายฮา สนิทกันมาก",
  },
  {
    label: "เจ้านาย - บริวาร (ข้า / เจ้า)",
    description: "ผู้มีอำนาจพูดกับบริวารหรือผู้ใต้บังคับบัญชา",
    firstPerson: "ข้า",
    secondPerson: "เจ้า",
    note: "เจ้านายพูดกับผู้ใต้บังคับบัญชา",
  },
];

interface ValidPronounEntry {
  speaker: string;
  listener: string;
  firstPerson: string;
  secondPerson: string;
  forbiddenPronouns?: string[];
  forbiddenHonorifics?: string[];
  note: string;
}

export function buildPronounMatrixDirectives(
  matrix?: PronounRelation[] | null,
): string {
  if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
    return "";
  }

  const validEntries: ValidPronounEntry[] = [];
  for (const entry of matrix) {
    if (!entry || typeof entry !== "object") continue;
    const speaker =
      typeof entry.speaker === "string" ? entry.speaker.trim() : "";
    const listener =
      typeof entry.listener === "string" ? entry.listener.trim() : "";
    const firstPerson =
      typeof entry.firstPerson === "string" ? entry.firstPerson.trim() : "";
    const secondPerson =
      typeof entry.secondPerson === "string" ? entry.secondPerson.trim() : "";
    const forbiddenPronouns = Array.isArray(entry.forbiddenPronouns)
      ? entry.forbiddenPronouns.filter((p: unknown): p is string => typeof p === "string" && !!p.trim())
      : undefined;
    const forbiddenHonorifics = Array.isArray(entry.forbiddenHonorifics)
      ? entry.forbiddenHonorifics.filter((h: unknown): h is string => typeof h === "string" && !!h.trim())
      : undefined;
    const note =
      typeof entry.note === "string" ? entry.note.trim() : "";

    if (!speaker || !listener || (!firstPerson && !secondPerson)) continue;
    validEntries.push({
      speaker,
      listener,
      firstPerson,
      secondPerson,
      ...(forbiddenPronouns && forbiddenPronouns.length > 0 ? { forbiddenPronouns } : {}),
      ...(forbiddenHonorifics && forbiddenHonorifics.length > 0 ? { forbiddenHonorifics } : {}),
      note,
    });
  }

  if (validEntries.length === 0) return "";

  const lines = validEntries.map(
    ({ speaker, listener, firstPerson, secondPerson, forbiddenPronouns, forbiddenHonorifics, note }) => {
      const parts: string[] = [];
      if (firstPerson) parts.push(`1st-person self: "${firstPerson}"`);
      if (secondPerson) parts.push(`2nd-person addressee: "${secondPerson}"`);
      if (forbiddenPronouns && forbiddenPronouns.length > 0) {
        parts.push(`FORBIDDEN pronouns: ${forbiddenPronouns.map((p: string) => `"${p}"`).join(", ")}`);
      }
      if (forbiddenHonorifics && forbiddenHonorifics.length > 0) {
        parts.push(`FORBIDDEN honorifics: ${forbiddenHonorifics.map((h: string) => `"${h}"`).join(", ")}`);
      }
      if (note) parts.push(`Tone/Nuance: ${note}`);
      return `- When "${speaker}" speaks to "${listener}": MUST use ${parts.join(", ")}`;
    },
  );

  return (
    `\nCHARACTER PRONOUN & RELATIONSHIP MATRIX (MANDATORY CONSISTENCY):\n` +
    `Strictly enforce these pronouns and tones when the characters address one another:\n` +
    lines.join("\n") +
    `\n`
  );
}

/**
 * Strips trailing forbidden honorifics (e.g. ครับ, ค่ะ, นะคะ) from translated text
 * while preserving trailing punctuation (!, ?, ..., ~).
 * Must be executed BEFORE typesetting layout measurement so that line-breaks and
 * font size calculation use the actual final string length.
 */
export function stripForbiddenHonorifics(
  text: string,
  forbiddenHonorifics?: string[] | null,
): string {
  if (!text || !Array.isArray(forbiddenHonorifics) || forbiddenHonorifics.length === 0) {
    return text;
  }

  const validHonorifics = forbiddenHonorifics
    .filter((h): h is string => typeof h === "string" && !!h.trim())
    .map((h) => h.trim());

  if (validHonorifics.length === 0) {
    return text;
  }

  // Sort by length descending so multi-word honorifics (e.g. "นะครับ") match before "ครับ"
  const sorted = [...validHonorifics].sort((a, b) => b.length - a.length);

  let cleaned = text;
  let changed = true;
  let iterations = 0;
  // Max 5 passes to handle stacked honorifics like "ครับผม" while guarding termination
  while (changed && iterations < 5) {
    changed = false;
    iterations++;
    for (const h of sorted) {
      const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?:\\s*${escaped})+(\\s*[!?.…~—\\s]*)$`, "u");
      const next = cleaned.replace(regex, "$1");
      if (next !== cleaned) {
        cleaned = next;
        changed = true;
      }
    }
  }

  return cleaned.trim();
}

export function mergePronounRelations(
  existing: PronounRelation[],
  incoming: PronounRelation[],
): { merged: PronounRelation[]; addedCount: number; updatedCount: number } {
  const mergedMap = new Map<string, PronounRelation>();

  for (const item of existing) {
    if (!item || !item.speaker || !item.listener) continue;
    const key = `${item.speaker.trim().toLowerCase()}->${item.listener.trim().toLowerCase()}`;
    mergedMap.set(key, { ...item });
  }

  let addedCount = 0;
  let updatedCount = 0;

  for (const item of incoming) {
    if (!item || !item.speaker || !item.listener) continue;
    const key = `${item.speaker.trim().toLowerCase()}->${item.listener.trim().toLowerCase()}`;
    if (mergedMap.has(key)) {
      mergedMap.set(key, { ...item });
      updatedCount += 1;
    } else {
      mergedMap.set(key, { ...item });
      addedCount += 1;
    }
  }

  return {
    merged: Array.from(mergedMap.values()),
    addedCount,
    updatedCount,
  };
}
