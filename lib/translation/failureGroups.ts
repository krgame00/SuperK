import {
  DIAGNOSTIC_TAXONOMY,
  type DiagnosticDetail,
} from "@/lib/translation/diagnostics";

export interface FailureGroupSource {
  failureGroupId: string;
  pageIndex: number;
  diagnostic?: DiagnosticDetail;
  message?: string;
}

export interface TranslationFailureGroup {
  id: string;
  diagnostic: DiagnosticDetail;
  pages: number[];
  pageIndices: number[];
  messages?: string[];
  cooldownUntil?: number;
  cooldownRemainingSeconds: number;
}

export function extendFailureGroupCooldown(
  cooldownByGroup: Record<string, number>,
  failureGroupId: string,
  candidateExpiry: number,
): Record<string, number> {
  return {
    ...cooldownByGroup,
    [failureGroupId]: Math.max(cooldownByGroup[failureGroupId] ?? 0, candidateExpiry),
  };
}

export function buildFailureGroups(
  failures: FailureGroupSource[],
  cooldownByGroup: Record<string, number> = {},
  nowMs = Date.now(),
): TranslationFailureGroup[] {
  const groups = new Map<string, TranslationFailureGroup>();

  for (const failure of failures) {
    const diagnostic = failure.diagnostic ?? DIAGNOSTIC_TAXONOMY.UNKNOWN_ERROR;
    const existing = groups.get(failure.failureGroupId);
    if (existing) {
      if (!existing.pageIndices.includes(failure.pageIndex)) {
        existing.pageIndices.push(failure.pageIndex);
        existing.pages.push(failure.pageIndex + 1);
      }
      if (failure.message && !existing.messages?.includes(failure.message)) {
        existing.messages = [...(existing.messages ?? []), failure.message];
      }
      continue;
    }

    const cooldownUntil = cooldownByGroup[failure.failureGroupId];
    groups.set(failure.failureGroupId, {
      id: failure.failureGroupId,
      diagnostic,
      pages: [failure.pageIndex + 1],
      pageIndices: [failure.pageIndex],
      messages: failure.message ? [failure.message] : [],
      ...(cooldownUntil ? { cooldownUntil } : {}),
      cooldownRemainingSeconds: cooldownUntil
        ? Math.max(0, Math.ceil((cooldownUntil - nowMs) / 1000))
        : 0,
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    pages: [...group.pages].sort((a, b) => a - b),
    pageIndices: [...group.pageIndices].sort((a, b) => a - b),
  }));
}
