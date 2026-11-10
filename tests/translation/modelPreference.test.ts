import { describe, expect, it } from "vitest";

import {
  AUTO_MODEL_PREFERENCE,
  modelPreferenceToString,
  normalizeLocalBaseUrl,
  parseModelPreference,
  readPersistedModelPreference,
  writePersistedModelPreference,
  type ModelPreference,
} from "@/lib/translation/modelPreference";

describe("parseModelPreference", () => {
  it("treats absent and auto as the auto engine", () => {
    expect(parseModelPreference(undefined)).toEqual(AUTO_MODEL_PREFERENCE);
    expect(parseModelPreference(null)).toEqual(AUTO_MODEL_PREFERENCE);
    expect(parseModelPreference("")).toEqual(AUTO_MODEL_PREFERENCE);
    expect(parseModelPreference("   ")).toEqual(AUTO_MODEL_PREFERENCE);
    expect(parseModelPreference("auto")).toEqual(AUTO_MODEL_PREFERENCE);
  });

  it("maps any other non-empty string to a Gemini model id, trimmed", () => {
    expect(parseModelPreference("gemini-3.8-flash")).toEqual({ engine: "gemini", model: "gemini-3.8-flash" });
    expect(parseModelPreference("  gemini-3.5-flash  ")).toEqual({ engine: "gemini", model: "gemini-3.5-flash" });
  });

  it("parses the bare local marker as local-but-unconfigured, never as a Gemini model id", () => {
    expect(parseModelPreference("local")).toEqual({ engine: "local", baseUrl: "", model: "" });
    expect(parseModelPreference(" local ")).toEqual({ engine: "local", baseUrl: "", model: "" });
  });

  it("parses the canonical object forms", () => {
    expect(parseModelPreference({ engine: "auto" })).toEqual(AUTO_MODEL_PREFERENCE);
    expect(parseModelPreference({ engine: "gemini", model: " gemini-3.8-flash " })).toEqual({
      engine: "gemini",
      model: "gemini-3.8-flash",
    });
    expect(
      parseModelPreference({ engine: "local", baseUrl: "http://localhost:11434", model: " qwen2.5-vl:7b " }),
    ).toEqual({ engine: "local", baseUrl: "http://localhost:11434/v1", model: "qwen2.5-vl:7b" });
  });

  it("keeps a malformed local object local with an empty base URL and model", () => {
    expect(parseModelPreference({ engine: "local", baseUrl: "not a url", model: "m" })).toEqual({
      engine: "local",
      baseUrl: "",
      model: "m",
    });
    expect(parseModelPreference({ engine: "local", baseUrl: 42, model: null })).toEqual({
      engine: "local",
      baseUrl: "",
      model: "",
    });
  });

  it("rejects a gemini object without a usable model id", () => {
    expect(parseModelPreference({ engine: "gemini", model: "" })).toBeNull();
    expect(parseModelPreference({ engine: "gemini", model: "   " })).toBeNull();
    expect(parseModelPreference({ engine: "gemini" })).toBeNull();
    expect(parseModelPreference({ engine: "gemini", model: 7 })).toBeNull();
  });

  it("rejects unknown engines and non-object payloads with null", () => {
    expect(parseModelPreference({ engine: "cloud" })).toBeNull();
    expect(parseModelPreference({})).toBeNull();
    expect(parseModelPreference([])).toBeNull();
    expect(parseModelPreference(42)).toBeNull();
    expect(parseModelPreference(true)).toBeNull();
  });

  it("ignores unknown keys inside the object (forward headroom)", () => {
    expect(
      parseModelPreference({ engine: "local", baseUrl: "http://h:1", model: "m", apiKey: "k", numCtx: 8192 }),
    ).toEqual({ engine: "local", baseUrl: "http://h:1/v1", model: "m" });
  });
});

describe("normalizeLocalBaseUrl", () => {
  it.each([
    ["http://localhost:11434", "http://localhost:11434/v1"],
    ["http://localhost:11434/", "http://localhost:11434/v1"],
    ["http://localhost:11434/v1/chat/completions", "http://localhost:11434/v1"],
    ["http://192.168.1.20:8080/llama", "http://192.168.1.20:8080/llama/v1"],
    ["http://localhost:1234/v1/", "http://localhost:1234/v1"],
    ["  http://localhost:11434  ", "http://localhost:11434/v1"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeLocalBaseUrl(input)).toBe(expected);
  });

  it.each([
    ["ftp://x"],
    ["not a url"],
    ["localhost:11434"],
    ["chrome-extension://abc"],
  ])("returns null for %s", (input) => {
    expect(normalizeLocalBaseUrl(input)).toBeNull();
  });

  it("keeps empty input empty (unconfigured)", () => {
    expect(normalizeLocalBaseUrl("")).toBe("");
    expect(normalizeLocalBaseUrl("   ")).toBe("");
  });
});

describe("modelPreferenceToString", () => {
  it("encodes each engine for string-only surfaces", () => {
    expect(modelPreferenceToString(AUTO_MODEL_PREFERENCE)).toBe("auto");
    expect(modelPreferenceToString({ engine: "gemini", model: "gemini-3.8-flash" })).toBe("gemini-3.8-flash");
    expect(modelPreferenceToString({ engine: "local", baseUrl: "http://h:1/v1", model: "q" })).toBe("local");
  });

  it("round-trips through the parser without turning local into a Gemini model id", () => {
    const pref: ModelPreference = { engine: "local", baseUrl: "http://h:1/v1", model: "q" };
    const parsed = parseModelPreference(modelPreferenceToString(pref));
    expect(parsed).toEqual({ engine: "local", baseUrl: "", model: "" });
    expect(parseModelPreference(modelPreferenceToString({ engine: "gemini", model: "gemini-x" }))).toEqual({
      engine: "gemini",
      model: "gemini-x",
    });
  });
});

describe("model preference persistence", () => {
  function fakeStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      map,
    };
  }

  it("round-trips the canonical JSON through an injected storage", () => {
    const storage = fakeStorage();
    const pref: ModelPreference = { engine: "local", baseUrl: "http://localhost:11434/v1", model: "qwen2.5-vl:7b" };
    writePersistedModelPreference(pref, storage);
    expect(storage.map.get("superk:model-preference")).toBe(JSON.stringify(pref));
    expect(readPersistedModelPreference(storage)).toEqual(pref);
  });

  it("keeps the selection alive when the storage quota is exceeded", () => {
    const fullStorage = {
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    };
    expect(() =>
      writePersistedModelPreference(
        { engine: "local", baseUrl: "http://localhost:11434/v1", model: "qwen2.5vl:7b" },
        fullStorage,
      ),
    ).not.toThrow();
  });

  it("falls back to auto when the key is absent", () => {
    expect(readPersistedModelPreference(fakeStorage())).toEqual(AUTO_MODEL_PREFERENCE);
  });

  it("accepts a bare legacy string in a hand-edited key", () => {
    const storage = fakeStorage();
    storage.setItem("superk:model-preference", "gemini-3.8-flash");
    expect(readPersistedModelPreference(storage)).toEqual({ engine: "gemini", model: "gemini-3.8-flash" });
  });

  it("falls back to auto on corrupt or invalid stored values", () => {
    const corrupt = fakeStorage();
    corrupt.setItem("superk:model-preference", '{"engine":');
    expect(readPersistedModelPreference(corrupt)).toEqual(AUTO_MODEL_PREFERENCE);

    const invalid = fakeStorage();
    invalid.setItem("superk:model-preference", JSON.stringify({ engine: "nope" }));
    expect(readPersistedModelPreference(invalid)).toEqual(AUTO_MODEL_PREFERENCE);
  });
});
