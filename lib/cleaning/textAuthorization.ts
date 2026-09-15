import type { CleaningResult } from "./types";

export function authorizationIdentity(regions: CleaningResult["regions"]): string {
  return JSON.stringify(regions.map(r => [r.id, r.rect, r.textConfirmed === true,
    r.maskApproved === true, r.approvalRevision ?? null, r.textRole]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export interface TranslationScope {
  /** Page-normalized [top, left, bottom, right], in thousandths. */
  allowed: number[][];
  excluded: number[][];
}

export function translationScope(result: CleaningResult): TranslationScope {
  const scope: TranslationScope = { allowed: [], excluded: [] };
  for (const region of result.regions) {
    const r = region.rect;
    const box = [r.y / result.height * 1000, r.x / result.width * 1000,
      (r.y + r.height) / result.height * 1000, (r.x + r.width) / result.width * 1000];
    if (region.textRole === "protected") {
      scope.excluded.push(box);
    } else {
      scope.allowed.push(box);
    }
  }
  return scope;
}

function intersection(a: number[], b: number[]): number {
  return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
}

export function withinTranslationScope(box: number[] | undefined, scope?: TranslationScope): boolean {
  if (!scope) return true;
  if (!box || box.length !== 4 || !box.every(Number.isFinite)) return false;
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  if (area <= 0 || scope.excluded.some(r => intersection(box, r) > 0)) return false;
  if (scope.allowed.length === 0) return true;
  return scope.allowed.some(r => intersection(box, r) / area >= 0.3);
}


/** Keep page coordinates while withholding unconfirmed pixels from recognition. */
export function scopedRecognitionImage(image: HTMLImageElement, scope: TranslationScope): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot prepare confirmed text for translation.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const rect = (box: number[]): [number, number, number, number] => [
    box[1] * canvas.width / 1000, box[0] * canvas.height / 1000,
    (box[3] - box[1]) * canvas.width / 1000, (box[2] - box[0]) * canvas.height / 1000,
  ];
  for (const box of scope.allowed) {
    const r = rect(box);
    context.drawImage(image, ...r, ...r);
  }
  for (const box of scope.excluded) context.fillRect(...rect(box));
  return canvas.toDataURL("image/png");
}
