import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/server/geminiTranslationRouter", async (original) => ({
  ...await original<typeof import("@/lib/server/geminiTranslationRouter")>(),
  executeGeminiTranslation: vi.fn(),
}));
vi.mock("@/lib/server/geminiRequest", async (original) => ({
  ...await original<typeof import("@/lib/server/geminiRequest")>(),
  requestOpenAICompatible: vi.fn(),
}));

import { executeGeminiTranslation } from "@/lib/server/geminiTranslationRouter";
import { GeminiRequestError, requestOpenAICompatible } from "@/lib/server/geminiRequest";
import { POST } from "@/src/app/api/translation-review/route";
import { buildTranslationPrompt } from "@/src/app/api/translate/handler";

const execute = vi.mocked(executeGeminiTranslation);
const compatible = vi.mocked(requestOpenAICompatible);
const items = [{ id: "0", sourceText: "Hello", translatedText: "สวัสดี" }];
const reviews = [{ id: "0", status: "ok" }];
function result(data: unknown) {
  return { data, model: "discovered-model", keyIndex: 0, meta: { provider: "gemini" as const, model: "discovered-model", attemptCount: 1, elapsedMs: 1, fallbackCount: 0 } };
}
function geminiData(value: unknown = { reviews }) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] };
}
function request(body: unknown = { items, targetLang: "Thai", apiKey: "user-key", allowPreview: true }, signal?: AbortSignal) {
  return new Request("http://localhost/api/translation-review", { method: "POST", body: JSON.stringify(body), signal });
}

describe("translation review API", () => {
  test.each([
    { translatedText: "กลิ่นนี่มันมีมนמהขลังอะไรกันแน่...", row: { id: "0", status: "ok" } },
    { translatedText: "สวัสดี", row: { id: "0", status: "suggested", suggestion: "สวัสดีמה" } },
  ])("guards provider rows before sending them to the client: $translatedText", async ({translatedText,row}) => {
    execute.mockResolvedValueOnce(result(geminiData({ reviews: [row] })));
    const response=await POST(request({items:[{...items[0],translatedText}],targetLang:"Thai"}));
    expect(await response.json()).toMatchObject({reviews:[{id:"0",status:"needs_review",reason:expect.stringContaining("מה")}]});
  });
  test("does not block Hebrew approval for a Hebrew target", async () => {
    execute.mockResolvedValueOnce(result(geminiData()));
    const response=await POST(request({items:[{...items[0],translatedText:"שלום"}],targetLang:"Hebrew"}));
    expect(await response.json()).toEqual({reviews});
  });
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "server-key");
    vi.stubEnv("SUPERK_TRANSLATE_BASE_URL", "");
    vi.stubEnv("SUPERK_TRANSLATE_API_KEY", "");
    execute.mockReset().mockResolvedValue(result(geminiData()));
    compatible.mockReset();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  test("uses catalog text routing and bounded provider requests", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reviews });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ workflow: "text", userApiKeyRaw: "user-key", serverApiKeyRaw: "server-key", allowPreview: true, totalBudgetMs: 45_000, signal: expect.any(AbortSignal) }));
    expect(compatible).not.toHaveBeenCalled();
    expect(JSON.stringify(execute.mock.calls[0][0].payload)).not.toContain("BLOCK_NONE");
  });

  test.each([
    null, { items: [] }, { items: Array.from({ length: 65 }, (_, id) => ({ ...items[0], id: String(id) })) },
    { items: [{ ...items[0], sourceText: "x".repeat(2001) }] },
    { items: [items[0], items[0]] }, { items: [{ ...items[0], id: "__proto__" }] },
    { items, glossary: [{ source: "name", target: 123 }] }, { items, allowPreview: "true" },
  ])("rejects invalid input without calling providers: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    expect(compatible).not.toHaveBeenCalled();
  });

  test.each([
    { reviews: [{ id: "0", status: "accepted" }] },
    { reviews: [{ id: "0", status: "suggested" }] },
    { reviews: [{ id: "42", status: "ok" }] },
    { reviews: [reviews[0], reviews[0]] }, { reviews: "bad" },
  ])("rejects malformed provider results: %j", async (value) => {
    execute.mockResolvedValueOnce(result(geminiData(value)));
    expect((await POST(request())).status).toBe(502);
  });

  test("missing IDs remain missing rather than becoming ok", async () => {
    execute.mockResolvedValueOnce(result(geminiData({ reviews: [] })));
    expect(await (await POST(request())).json()).toEqual({ reviews: [] });
  });

  test("configured compatible provider receives text review and never falls back after refusal", async () => {
    vi.stubEnv("SUPERK_TRANSLATE_BASE_URL", "http://provider");
    vi.stubEnv("SUPERK_TRANSLATE_API_KEY", "configured-key");
    compatible.mockResolvedValueOnce(result({ choices: [{ message: { content: JSON.stringify({ reviews }) }, finish_reason: "stop" }] }));
    expect((await POST(request())).status).toBe(200);
    expect(compatible).toHaveBeenCalledWith(expect.objectContaining({ totalBudgetMs: 45_000, signal: expect.any(AbortSignal) }));
    compatible.mockResolvedValueOnce(result({ choices: [{ message: { refusal: "blocked", content: JSON.stringify({ reviews }) }, finish_reason: "stop" }] }));
    expect((await POST(request())).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  test("Gemini safety responses cannot become successful reviews", async () => {
    execute.mockResolvedValueOnce(result({ ...geminiData(), promptFeedback: { blockReason: "SAFETY" } }));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("SAFETY_BLOCKED");
  });

  test("configured provider failures remain unavailable without exposing keys or falling back", async () => {
    vi.stubEnv("SUPERK_TRANSLATE_BASE_URL", "http://provider");
    vi.stubEnv("SUPERK_TRANSLATE_API_KEY", "configured-key");
    compatible.mockRejectedValueOnce(new GeminiRequestError("Quota exceeded configured-key", "GEMINI_QUOTA", 429, true));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(JSON.stringify(await response.json())).not.toContain("configured-key");
    expect(execute).not.toHaveBeenCalled();
  });

  test("Gemini finish-reason blocks remain blocked even if text contains valid JSON", async () => {
    execute.mockResolvedValueOnce(result({ candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: JSON.stringify({ reviews }) }] } }] }));
    expect((await POST(request())).status).toBe(400);
  });

  test("cancellation aborts an in-flight provider and returns aborted code", async () => {
    const abort = new AbortController();
    let providerSignal: AbortSignal | undefined;
    execute.mockImplementationOnce(async (options) => { providerSignal = options.signal; return await new Promise(() => {}); });
    const pending = POST(request(undefined, abort.signal));
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    abort.abort();
    expect((await pending).status).toBe(499);
    expect(providerSignal?.aborted).toBe(true);
  });

  test("the whole review stops after 45 seconds even when provider ignores abort", async () => {
    vi.useFakeTimers();
    execute.mockImplementationOnce(async () => await new Promise(() => {}));
    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await pending).status).toBe(504);
  });

  test("translation prompt requires exact source capture and faithful meaning", () => {
    const prompt = buildTranslationPrompt({ targetLang: "Thai" });
    expect(prompt).toContain("original_text EXACTLY");
    expect(prompt).toContain("Do not omit or add meaning");
    expect(prompt).toContain("invent pronouns");
  });
});
