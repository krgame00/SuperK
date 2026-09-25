// Preserve the production image translation fallback order. The Settings
// picker intersects this list with live discovery and current route health.
export const FIXED_IMAGE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

// These two fixed fallbacks remain in Auto for rollback compatibility, but
// should not be recommended as Manual choices: one returned 404 and the other
// failed the real image workload in prior verification.
const UNVERIFIED_MANUAL_MODELS = new Set(["gemini-3-flash", "gemini-3.6-flash"]);
export const MANUAL_IMAGE_MODEL_IDS: ReadonlySet<string> = new Set(
  FIXED_IMAGE_MODELS.filter((id) => !UNVERIFIED_MANUAL_MODELS.has(id)),
);
