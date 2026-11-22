// The overlay renderer asks for one AI suggestion per bubble through this
// action. The API key reaches it through an injectable provider so rendering
// code never touches the key store directly; the caller owns the provider.

export interface TranslationReviewRow {
  suggestion?: string;
  status?: string;
  reason?: string;
}

export type ReviewApiKeyProvider = () => string;

export const defaultReviewApiKeyProvider: ReviewApiKeyProvider = () =>
  typeof localStorage !== "undefined" ? (localStorage.getItem("gemini_api_key") || "") : "";

export const requestTranslationReview = async (
  sourceText: string | undefined,
  translatedText: string,
  targetLang: string,
  apiKeyProvider: ReviewApiKeyProvider,
  repairMode: boolean,
): Promise<TranslationReviewRow | null> => {
  const res = await fetch("/api/translation-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: "0", sourceText, translatedText }],
      targetLang: targetLang || "Thai",
      apiKey: apiKeyProvider(),
      ...(repairMode ? { mode: "repair" } : {}),
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data?.reviews) ? data.reviews[0] ?? null : null;
};
