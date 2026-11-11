import { normalizeThaiText } from "@/lib/thaiSpellcheck";

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
