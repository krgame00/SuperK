import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock requestGemini
const mockRequestGemini = vi.fn();
vi.mock("@/lib/server/geminiRequest", () => ({
  requestGemini: (...args: unknown[]) => mockRequestGemini(...args),
  GeminiRequestError: class GeminiRequestError extends Error {
    constructor(message: string, public status = 500, public code = "ERROR", public retryable = false) {
      super(message);
    }
  },
}));

// Mock requireLocalRequest to allow requests
vi.mock("@/lib/server/localRequest", () => ({
  requireLocalRequest: () => null,
}));

// Mock getSyncedExtensionSettings
vi.mock("@/src/app/api/extension/settings/handler", () => ({
  getSyncedExtensionSettings: () => ({ geminiApiKey: "test-api-key", glossary: [] }),
}));

describe("POST /api/translate-text with Glossary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "dummy-key";
  });

  it("injects glossary directives into the Gemini prompt when glossary is provided", async () => {
    const { POST } = await import("@/src/app/api/translate-text/route");

    mockRequestGemini.mockResolvedValueOnce({
      keyIndex: 0,
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    bubbles: [
                      { id: 1, t: "ลูฟี่ นายจะไปไหน?", box: [100, 200, 300, 400] },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      },
    });

    const req = new Request("http://localhost/api/translate-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bubbles: [{ id: 1, text: "Luffy, where are you going?", box: [100, 200, 300, 400] }],
        targetLang: "Thai",
        glossary: [
          { source: "Luffy", target: "ลูฟี่", note: "กัปตันเรือ" },
          { source: "Sensei", target: "อาจารย์" },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockRequestGemini).toHaveBeenCalledTimes(1);
    const callArgs = mockRequestGemini.mock.calls[0][0];
    const promptText = callArgs.payload.contents[0].parts[0].text;

    // Must contain glossary lock header and rules
    expect(promptText).toContain("GLOSSARY & CHARACTER NAME LOCK (MANDATORY - DO NOT ALTER):");
    expect(promptText).toContain('- "Luffy" MUST ALWAYS be translated as "ลูฟี่" (กัปตันเรือ)');
    expect(promptText).toContain('- "Sensei" MUST ALWAYS be translated as "อาจารย์"');
  });

  it("omits glossary directives when glossary is empty or undefined", async () => {
    const { POST } = await import("@/src/app/api/translate-text/route");

    mockRequestGemini.mockResolvedValueOnce({
      keyIndex: 0,
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    bubbles: [{ id: 1, t: "สวัสดี", box: [0, 0, 10, 10] }],
                  }),
                },
              ],
            },
          },
        ],
      },
    });

    const req = new Request("http://localhost/api/translate-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bubbles: [{ id: 1, text: "Hello", box: [0, 0, 10, 10] }],
        targetLang: "Thai",
        glossary: [],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const callArgs = mockRequestGemini.mock.calls[0][0];
    const promptText = callArgs.payload.contents[0].parts[0].text;
    expect(promptText).not.toContain("GLOSSARY & CHARACTER NAME LOCK");
  });
});
