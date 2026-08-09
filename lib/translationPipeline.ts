export type ImageDimensions = {
  width: number;
  height: number;
};

export type TranslationOutcome<T> =
  | { kind: "render"; bubbles: T[] }
  | { kind: "clean-only"; bubbles: [] };

export function resolveTranslationOutcome<T>(
  aiBubbles: readonly T[],
  manualBubbles: readonly T[],
): TranslationOutcome<T> {
  const bubbles = [...aiBubbles, ...manualBubbles];

  return bubbles.length > 0
    ? { kind: "render", bubbles }
    : { kind: "clean-only", bubbles: [] };
}

export function assertMatchingImageDimensions(
  recognition: ImageDimensions,
  background: ImageDimensions,
): void {
  if (
    recognition.width <= 0 ||
    recognition.height <= 0 ||
    background.width <= 0 ||
    background.height <= 0
  ) {
    throw new Error(
      "Cleaning failed: image dimensions must be positive before translation.",
    );
  }

  if (
    recognition.width !== background.width ||
    recognition.height !== background.height
  ) {
    throw new Error(
      `Cleaning failed: recognition and background dimensions must match (${recognition.width}x${recognition.height} vs ${background.width}x${background.height}).`,
    );
  }
}
