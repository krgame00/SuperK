import type { TranslatedBubble } from './translationOverlay';

export const sizingKeys = ['sourceSizing','targetFontSize','fontSizeMultiplier','layoutAdjustment','layoutSnapshot','userTextSpace'] as const;
export type SizeSnapshot = Pick<TranslatedBubble, typeof sizingKeys[number]>;
export function snapshotSizing(bubble: TranslatedBubble): SizeSnapshot {
  const result: SizeSnapshot = {};
  for (const key of sizingKeys) if (bubble[key] !== undefined) Object.assign(result, {[key]: structuredClone(bubble[key])});
  return result;
}
export function restoreSizing(bubble: TranslatedBubble, snapshot: SizeSnapshot): void {
  for (const key of sizingKeys) delete bubble[key];
  Object.assign(bubble, structuredClone(snapshot));
}
export function isManualSized(bubble: TranslatedBubble): boolean {
  return bubble.sourceSizing?.mode === 'manual' || (!bubble.sourceSizing &&
    (bubble.targetFontSize !== undefined || bubble.fontSizeMultiplier !== undefined || bubble.layoutAdjustment?.targetFontSize !== undefined));
}
export function resetSizingToAuto(bubble: TranslatedBubble): void {
  delete bubble.sourceSizing;
  delete bubble.targetFontSize;
  delete bubble.fontSizeMultiplier;
  delete bubble.layoutSnapshot;
  if (bubble.layoutAdjustment) {
    delete bubble.layoutAdjustment.targetFontSize;
    delete bubble.layoutAdjustment.fontSizeMultiplier;
    delete bubble.layoutAdjustment.layoutSnapshot;
  }
}
