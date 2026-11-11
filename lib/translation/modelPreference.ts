export type ModelPreference =
  | { engine: "auto" }
  | { engine: "gemini"; model: string }
  | { engine: "local"; baseUrl: string; model: string };

/** What may appear on the wire: legacy string or canonical object. */
export type ModelPreferenceWire = string | ModelPreference;

export const AUTO_MODEL_PREFERENCE: ModelPreference = { engine: "auto" };

/**
 * Detects whether a model identifier indicates multimodal / vision capabilities
 * (e.g. qwen2.5vl, qwen2.5-vl, llama3.2-vision, minicpm-v, llava, pixtral).
 * Text-only models like qwen2.5:7b or llama3:8b return false.
 */
export function isVisionModelName(modelName: string): boolean {
  if (!modelName) return false;
  const lower = modelName.toLowerCase();
  return (
    lower.includes("vl") ||
    lower.includes("vision") ||
    lower.includes("llava") ||
    lower.includes("minicpm-v") ||
    lower.includes("pixtral")
  );
}

const MODEL_PREFERENCE_STORAGE_KEY = "superk:model-preference";

/**
 * The "/v1" suffix matters because requestOpenAICompatible appends
 * "/chat/completions" and Ollama/llama.cpp serve /v1/chat/completions —
 * the normalized base plus that existing append yields the correct URL.
 */
export function normalizeLocalBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let path = parsed.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) {
    path = path.slice(0, -"/chat/completions".length);
  }
  if (!path.endsWith("/v1")) {
    path = `${path}/v1`;
  }
  return `${parsed.origin}${path}`;
}

/** null means the caller must reject the request (400 INVALID_REQUEST). */
export function parseModelPreference(raw: unknown): ModelPreference | null {
  if (raw === undefined || raw === null) return AUTO_MODEL_PREFERENCE;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "auto") return AUTO_MODEL_PREFERENCE;
    // Extension sync stores the bare marker: local-selected but configured
    // only in the browser, so it must surface as unconfigured, never cloud.
    if (trimmed === "local") return { engine: "local", baseUrl: "", model: "" };
    return { engine: "gemini", model: trimmed };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as { engine?: unknown; baseUrl?: unknown; model?: unknown };
  if (record.engine === "auto") return AUTO_MODEL_PREFERENCE;
  if (record.engine === "gemini") {
    const model = typeof record.model === "string" ? record.model.trim() : "";
    if (!model) return null;
    return { engine: "gemini", model };
  }
  if (record.engine === "local") {
    const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl : "";
    return {
      engine: "local",
      baseUrl: baseUrl.trim() ? normalizeLocalBaseUrl(baseUrl) ?? "" : "",
      model: typeof record.model === "string" ? record.model.trim() : "",
    };
  }
  return null;
}

/** String encoding for surfaces that still speak strings (extension sync, review client). */
export function modelPreferenceToString(pref: ModelPreference): string {
  if (pref.engine === "auto") return "auto";
  if (pref.engine === "local") return "local";
  return pref.model;
}

export function readPersistedModelPreference(storage?: Pick<Storage, "getItem">): ModelPreference {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  const raw = store?.getItem(MODEL_PREFERENCE_STORAGE_KEY);
  if (!raw) return AUTO_MODEL_PREFERENCE;
  try {
    return parseModelPreference(JSON.parse(raw)) ?? AUTO_MODEL_PREFERENCE;
  } catch {
    // A hand-edited key may hold the bare legacy string instead of JSON;
    // JSON-shaped garbage is corruption, never a model id.
    if (raw.trim().startsWith("{")) return AUTO_MODEL_PREFERENCE;
    return parseModelPreference(raw) ?? AUTO_MODEL_PREFERENCE;
  }
}

export function writePersistedModelPreference(pref: ModelPreference, storage?: Pick<Storage, "setItem">): void {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!store) return;
  try {
    store.setItem(MODEL_PREFERENCE_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Quota exceeded or blocked storage: the selection stays alive in memory
    // for this session and simply will not survive a reload.
  }
}
