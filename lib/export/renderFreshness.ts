export const shouldReuseCachedTranslatedRender = (isDirty: boolean): boolean => !isDirty;

export const shouldReuseSpilledTranslatedRender = (
  bubbles: readonly unknown[] | null | undefined,
): boolean => !bubbles || bubbles.length === 0;
