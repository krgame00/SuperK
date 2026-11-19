export type SfxPolicyMode = "ignore" | "preserve" | "translate";
export type CleaningScopeMode = "safe" | "all-text";

export const SFX_POLICY_STORAGE_KEY = "superk:sfx-policy";
export const DEFAULT_SFX_POLICY: SfxPolicyMode = "ignore";

export function normalizeSfxPolicy(raw: unknown): SfxPolicyMode {
  if (raw === "ignore" || raw === "preserve" || raw === "translate") {
    return raw;
  }
  return DEFAULT_SFX_POLICY;
}

export function readStoredSfxPolicy(): SfxPolicyMode {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return DEFAULT_SFX_POLICY;
  }
  try {
    return normalizeSfxPolicy(localStorage.getItem(SFX_POLICY_STORAGE_KEY));
  } catch {
    return DEFAULT_SFX_POLICY;
  }
}

export function sfxPolicyToCleaningMode(policy: SfxPolicyMode): CleaningScopeMode {
  return policy === "translate" ? "all-text" : "safe";
}
