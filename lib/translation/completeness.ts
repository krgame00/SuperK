import type { TranslatedBubble } from '@/lib/translationOverlay';
import { withinTranslationScope, type TranslationScope } from '@/lib/cleaning/textAuthorization';
import { isUserCancelledError, normalizeTranslationErrorCode } from './requestError';

function validBox(box?: number[]): box is number[] {
  return !!box && box.length === 4 && box.every(Number.isFinite) &&
    box[2] > box[0] && box[3] > box[1] &&
    box.every(v => v >= 0 && v <= 1000) &&
    !(box[2]-box[0] >= 950 && box[3]-box[1] >= 950);
}

function area(box: number[]): number { return (box[2]-box[0])*(box[3]-box[1]); }
function overlap(a: number[], b: number[]): number {
  return Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])) *
    Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
}
function textOf(b: TranslatedBubble): string { return (b.t || b.translated || '').trim(); }
function manual(b: TranslatedBubble): boolean {
  return !!b.isManual || b.styleProfile?.source === 'manual' || b.styleProfile?.ownershipMode === 'manual';
}

/** Identical words at distinct positions are legitimate repeated dialogue/SFX. */
export function deduplicateTranslations(bubbles: TranslatedBubble[]): TranslatedBubble[] {
  const result: TranslatedBubble[] = [];
  for (const bubble of bubbles) {
    const index = validBox(bubble.box) && !bubble.isInvalidBox && textOf(bubble)
      ? result.findIndex(existing => !existing.isInvalidBox && existing.deleted === bubble.deleted &&
        textOf(existing) === textOf(bubble) && validBox(existing.box) &&
        overlap(existing.box, bubble.box!) / (area(existing.box)+area(bubble.box!)-overlap(existing.box,bubble.box!)) >= .6)
      : -1;
    if (index < 0) result.push(bubble);
    else if (manual(bubble) && !manual(result[index])) result[index] = bubble;
  }
  return result;
}

function covers(bubble: TranslatedBubble, target: number[]): boolean {
  if (bubble.isInvalidBox || !validBox(bubble.box)) return false;
  if (!bubble.deleted && !textOf(bubble)) return false;
  const small = Math.min(area(bubble.box),area(target));
  const large = Math.max(area(bubble.box),area(target));
  return large/small <= 8 && overlap(bubble.box,target)/area(target) >= .6;
}

/** Detector regions are looser than text boxes, so a recovered candidate only
 *  needs to sit substantially inside the region it was cropped for. */
function anchorsToTarget(box: number[] | undefined, target: number[]): boolean {
  if (!validBox(box)) return false;
  const targetArea = area(target);
  const small = Math.min(area(box!),targetArea);
  const large = Math.max(area(box!),targetArea);
  return large/small <= 8 && overlap(box!,target)/targetArea >= .35;
}

function anchored(bubble: TranslatedBubble, target: number[]): boolean {
  return !bubble.isInvalidBox && !bubble.deleted && !!textOf(bubble) && anchorsToTarget(bubble.box,target);
}

/** Tombstones from user edits also suppress replacement provider results. */
export function excludeDeletedTranslations(bubbles: TranslatedBubble[], tombstones: TranslatedBubble[]): TranslatedBubble[] {
  return bubbles.filter(b => b.deleted || !validBox(b.box) ||
    !tombstones.some(deleted => deleted.deleted && covers(deleted,b.box!)));
}

/** Dialogue and narration regions get the limited recovery budget first;
 *  uncertain "review" regions would otherwise eat every slot. */
const RECOVERY_ROLE_PRIORITY: Record<string, number> = { dialogue: 0, narration: 0 };

/** Coverage is geometric and limited to regions the detector actually found. */
export function findMissingTranslationRegions(bubbles: TranslatedBubble[], scope?: TranslationScope): number[][] {
  if (!scope) return [];
  const missing = scope.allowed.filter(box => validBox(box) &&
    !scope.excluded.some(protectedBox => validBox(protectedBox) && overlap(box,protectedBox)>0) &&
    !bubbles.some(b => covers(b,box) || anchored(b,box)));
  const roles = scope.allowedRoles;
  if (!roles) return missing;
  const rank = (box: number[]): number => {
    const index = scope.allowed.indexOf(box);
    return RECOVERY_ROLE_PRIORITY[roles[index] ?? ''] ?? 1;
  };
  return [...missing].sort((x,y) => rank(x) - rank(y));
}

/** A recovered target was not adequately translated before, so the fresh result
 *  must not stack on the partial rendering that triggered the recovery. */
function supersedes(candidate: TranslatedBubble, existing: TranslatedBubble): boolean {
  if (existing.deleted || existing.isInvalidBox || manual(existing) || !textOf(existing)) return false;
  if (!validBox(existing.box) || !validBox(candidate.box)) return false;
  if (area(existing.box)/area(candidate.box) > 8) return false;
  return overlap(existing.box,candidate.box!)/area(existing.box) >= .5;
}

export async function recoverMissingTranslations(
  bubbles: TranslatedBubble[], scope: TranslationScope | undefined,
  recover: (box: number[]) => Promise<TranslatedBubble[]>, signal?: AbortSignal,
): Promise<{bubbles: TranslatedBubble[]; missing: number[][]}> {
  const abort = () => { if (signal?.aborted) throw new DOMException('Translation cancelled','AbortError'); };
  abort();
  let combined = [...bubbles];
  const targets = findMissingTranslationRegions(combined,scope).slice(0,6);
  for (const target of targets) {
    abort();
    if (!findMissingTranslationRegions(combined,scope).includes(target)) continue;
    try {
      const candidates = await recover(target);
      abort();
      const admitted = excludeDeletedTranslations(candidates.filter(b =>
        !b.deleted && !!textOf(b) && anchorsToTarget(b.box,target) && withinTranslationScope(b.box,scope)),combined.filter(b=>b.deleted));
      combined = deduplicateTranslations([
        ...combined.filter(existing => !admitted.some(candidate => supersedes(candidate,existing))),
        ...admitted,
      ]);
    } catch (error) {
      abort();
      if (isUserCancelledError(error)) throw error;
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
      const category = normalizeTranslationErrorCode(code || status);
      if (category === 'safety' || category === 'quota' || category === 'auth' || /COOLDOWN/i.test(code)) break;
    }
  }
  return {bubbles:combined,missing:findMissingTranslationRegions(combined,scope)};
}
