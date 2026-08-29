export interface TranslationPolicy {
  dialogue: "translate";
  narration: "translate";
  sfx: "translate" | "preserve" | "ignore";
  credits: "preserve" | "ignore";
  uncertainText: "translate" | "review";
}

export const DEFAULT_TRANSLATION_POLICY: TranslationPolicy = {
  dialogue: "translate",
  narration: "translate",
  sfx: "ignore",
  credits: "ignore",
  uncertainText: "translate",
};

export function resolveTranslationPolicy(
  policy?: Partial<TranslationPolicy> | null,
): TranslationPolicy {
  return {
    ...DEFAULT_TRANSLATION_POLICY,
    ...(policy ?? {}),
  };
}

export function buildPolicyDirectives(
  policy?: Partial<TranslationPolicy> | null,
): string {
  const effective = resolveTranslationPolicy(policy);
  const rules: string[] = [
    "- Translate ONLY story-bearing dialogue, thoughts, and narration.",
    "- Narration may appear without a speech bubble; include it when it forms a readable story sentence or caption.",
    "- IGNORE interface text: HUD elements, menus, button labels, character or stat labels, counters, status values, credits, watermarks, and other small scattered labels.",
  ];

  if (effective.sfx === "ignore") {
    rules.push("- IGNORE all Sound Effects (SFX). Do NOT translate them.");
  } else if (effective.sfx === "preserve") {
    rules.push(
      "- PRESERVE Sound Effects (SFX) in original form without translation.",
    );
  } else if (effective.sfx === "translate") {
    rules.push(
      "- Translate Sound Effects (SFX) and wrap them in asterisks, e.g., *BOOM* or *ตู้ม*.",
    );
  }

  rules.push(
    "- DO NOT hallucinate text on textures, leaves, clothing, shading, or backgrounds. If an area does not clearly contain readable story text, ignore it completely.",
  );

  return rules.join("\n");
}
