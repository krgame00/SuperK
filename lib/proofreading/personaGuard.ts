import { normalizeThaiText } from "@/lib/thaiSpellcheck";
import type { PronounRelation } from "@/lib/translation/pronounMatrix";
import type { TranslatedBubble } from "@/lib/translationOverlay";

export type ToneRegister = "vulgar" | "casual" | "polite" | "royal" | "archaic";

export interface CharacterPersona {
  characterId: string;
  primaryName: string;
  aliases?: string[];
  firstPersonPronouns: string[];
  secondPersonPronouns: string[];
  forbiddenPronouns?: string[];
  forbiddenHonorifics?: string[];
  toneRegister: ToneRegister;
}

export interface ProofreadCorrection {
  type: "orthography" | "punctuation" | "honorific" | "pronoun";
  rule: string;
  original: string;
  corrected: string;
}

export interface ProofreadResult {
  text: string;
  changed: boolean;
  corrections: ProofreadCorrection[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure linter function to audit and auto-correct Thai dialogue text.
 * Covers orthography typos, punctuation folding, and character persona enforcement.
 */
export function auditAndCorrectDialogue(
  text: string,
  persona?: CharacterPersona,
): ProofreadResult {
  if (!text || typeof text !== "string") {
    return { text: "", changed: false, corrections: [] };
  }

  const initialText = text;
  const corrections: ProofreadCorrection[] = [];

  // 1. Orthography & Punctuation Cleanup
  const normalized = normalizeThaiText(text);
  if (normalized !== text) {
    corrections.push({
      type: "orthography",
      rule: "orthography",
      original: text,
      corrected: normalized,
    });
  }

  let currentText = normalized;

  // 2. Character Persona Rules (if persona profile provided)
  if (persona) {
    // 2.1 Forbidden Pronouns Enforcement
    if (
      Array.isArray(persona.forbiddenPronouns) &&
      persona.forbiddenPronouns.length > 0 &&
      Array.isArray(persona.firstPersonPronouns) &&
      persona.firstPersonPronouns.length > 0
    ) {
      const preferredPronoun = persona.firstPersonPronouns[0];
      for (const forbidden of persona.forbiddenPronouns) {
        if (!forbidden) continue;
        const regex = new RegExp(escapeRegExp(forbidden), "g");
        if (regex.test(currentText)) {
          currentText = currentText.replace(regex, preferredPronoun);
          corrections.push({
            type: "pronoun",
            rule: "forbidden_pronoun",
            original: forbidden,
            corrected: preferredPronoun,
          });
        }
      }
    }

    // 2.2 Forbidden Honorifics Stripping (e.g. ครับ, ค่ะ from endings)
    if (
      Array.isArray(persona.forbiddenHonorifics) &&
      persona.forbiddenHonorifics.length > 0
    ) {
      let strippedInPass = true;
      let passes = 0;
      while (strippedInPass && passes < 5) {
        strippedInPass = false;
        passes++;
        for (const honorific of persona.forbiddenHonorifics) {
          if (!honorific) continue;
          // Match honorific near ending, followed by optional punctuation/whitespace
          const endRegex = new RegExp(
            `(\\s*${escapeRegExp(honorific)})([\\s!?.~—♥]*)$`,
            "g",
          );
          if (endRegex.test(currentText)) {
            currentText = currentText.replace(
              endRegex,
              (_match, _p1, punctuation: string) => punctuation || "",
            );
            corrections.push({
              type: "honorific",
              rule: "forbidden_honorific",
              original: honorific,
              corrected: "",
            });
            strippedInPass = true;
          }
        }
      }
    }
  }

  const changed = currentText !== initialText;

  return {
    text: currentText,
    changed,
    corrections,
  };
}

/**
 * Resolves a CharacterPersona profile from the PronounRelation matrix for a given speaker.
 * Matches by exact speaker name or case-insensitive / trimmed substring match.
 */
export function personaFromPronounMatrix(
  speaker: string,
  matrix?: PronounRelation[] | null,
): CharacterPersona | undefined {
  if (!speaker || !matrix || !Array.isArray(matrix) || matrix.length === 0) {
    return undefined;
  }

  const trimmedSpeaker = speaker.trim().toLowerCase();
  const matchingRelations = matrix.filter((r) => {
    if (!r.speaker) return false;
    const s = r.speaker.trim().toLowerCase();
    return s === trimmedSpeaker || trimmedSpeaker.includes(s) || s.includes(trimmedSpeaker);
  });

  if (matchingRelations.length === 0) return undefined;

  const firstPersonPronouns: string[] = [];
  const secondPersonPronouns: string[] = [];
  const forbiddenPronouns: string[] = [];
  const forbiddenHonorifics: string[] = [];

  for (const r of matchingRelations) {
    if (r.firstPerson && !firstPersonPronouns.includes(r.firstPerson)) {
      firstPersonPronouns.push(r.firstPerson);
    }
    if (r.secondPerson && !secondPersonPronouns.includes(r.secondPerson)) {
      secondPersonPronouns.push(r.secondPerson);
    }
    if (Array.isArray(r.forbiddenPronouns)) {
      for (const p of r.forbiddenPronouns) {
        if (p && !forbiddenPronouns.includes(p)) forbiddenPronouns.push(p);
      }
    }
    if (Array.isArray(r.forbiddenHonorifics)) {
      for (const h of r.forbiddenHonorifics) {
        if (h && !forbiddenHonorifics.includes(h)) forbiddenHonorifics.push(h);
      }
    }
  }

  return {
    characterId: matchingRelations[0].speaker,
    primaryName: matchingRelations[0].speaker,
    firstPersonPronouns,
    secondPersonPronouns,
    forbiddenPronouns,
    forbiddenHonorifics,
    toneRegister: "casual",
  };
}

/**
 * Audits a single TranslatedBubble against the pronoun matrix and persona rules.
 * If the bubble has a speaker matching the pronoun matrix, checks and corrects
 * forbidden honorifics, forbidden pronouns, and common orthography.
 */
export function auditBubbleWithPersona(
  bubble: TranslatedBubble,
  matrix?: PronounRelation[] | null,
): { bubble: TranslatedBubble; changed: boolean; corrections: ProofreadCorrection[] } {
  const currentText = bubble.t || bubble.translated || "";
  if (!currentText) {
    return { bubble, changed: false, corrections: [] };
  }

  const persona = bubble.speaker ? personaFromPronounMatrix(bubble.speaker, matrix) : undefined;
  const result = auditAndCorrectDialogue(currentText, persona);

  if (!result.changed) {
    return { bubble, changed: false, corrections: [] };
  }

  return {
    bubble: {
      ...bubble,
      t: result.text,
      translated: result.text,
    },
    changed: true,
    corrections: result.corrections,
  };
}
