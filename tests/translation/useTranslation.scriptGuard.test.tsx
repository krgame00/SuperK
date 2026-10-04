import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
import { loadProjectSession } from "@/lib/projectStore";
import { createPageTargetIdentity } from "@/lib/translation/pageEligibility";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      _viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
    ) => {
      onComplete?.("data:translated");
    },
  ),
  clearPageAdjustments: vi.fn(),
  clearAllAdjustments: vi.fn(),
  readOverlayAdjustments: vi.fn(() => ({})),
  bubbleKeyOf: vi.fn(() => "mock-key"),
}));

vi.mock("@/lib/projectStore", () => ({
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
}));

const contaminatedThai = { box: [100, 100, 300, 200], t: "สวัสดีこんにちは", original_text: "Hello" };
const cleanThai = { box: [100, 100, 300, 200], t: "สวัสดี", original_text: "Hello" };
const farewell = { box: [400, 400, 600, 500], t: "ลาก่อน", original_text: "Goodbye" };

const imageResponse = () =>
  new Response(new Blob(["clean"], { type: "image/png" }), { status: 200 });

const bubblesResponse = (bubbles: unknown[]) =>
  Response.json({ text: JSON.stringify({ bubbles }) });

interface ReviewBody {
  mode?: string;
  items: Array<{ id: string; sourceText: string; translatedText: string }>;
}

function lastRendered() {
  return vi
    .mocked(applyTranslationOverlay)
    .mock.calls.findLast((call) => call[1] === "offscreen")?.[0] as Array<{
    t?: string;
  }>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  const storageValues = new Map<string, string>();
  const storage = {
    get length() {
      return storageValues.size;
    },
    clear: () => storageValues.clear(),
    getItem: (key: string) => storageValues.get(key) ?? null,
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    removeItem: (key: string) => {
      storageValues.delete(key);
    },
    setItem: (key: string, value: string) => {
      storageValues.set(key, String(value));
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      naturalWidth = 1000;
      naturalHeight = 1000;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    })),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,c2xpY2U=",
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function renderTranslationHook(pages: string[], targetLang = "Thai") {
  const hook = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation: vi.fn().mockResolvedValue({
        recognitionUrl: "blob:one",
        backgroundUrl: "blob:clean-one",
      }),
    }),
  );
  if (targetLang !== "Thai") act(() => hook.result.current.setTargetLang(targetLang));
  return hook;
}

async function runTranslation(result: ReturnType<typeof renderTranslationHook>["result"]) {
  let translation!: Promise<boolean>;
  act(() => {
    translation = result.current.handleTranslate();
  });
  await act(async () => {
    // Bounded advancement: running all timers would fire the 4s message reset.
    await vi.advanceTimersByTimeAsync(100);
    expect(await translation).toBe(true);
  });
}

test("script contamination skips the whole-image retry and repairs only the affected point once", async () => {
  let translateCalls = 0;
  const reviewBodies: ReviewBody[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "blob:one" || url === "blob:clean-one") return imageResponse();
    if (url === "/api/translate") {
      translateCalls += 1;
      return bubblesResponse([contaminatedThai, farewell]);
    }
    if (url === "/api/translation-review") {
      const body = JSON.parse(String(init?.body)) as ReviewBody;
      reviewBodies.push(body);
      if (reviewBodies.length === 1) {
        return Response.json({
          reviews: [
            { id: "0", status: "needs_review", reason: "ตรวจพบตัวอักษรปน" },
            { id: "1", status: "ok" },
          ],
        });
      }
      return Response.json({
        reviews: [{ id: "0", status: "suggested", suggestion: "สวัสดี" }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderTranslationHook(["blob:one"]);
  await runTranslation(result);

  // The full original-image retry must not stack with the point repair round.
  expect(translateCalls).toBe(1);
  expect(reviewBodies).toHaveLength(2);
  expect(reviewBodies[1].mode).toBe("repair");
  expect(reviewBodies[1].items.map((item) => item.id)).toEqual(["0"]);
  expect(reviewBodies[1].items[0]).toMatchObject({
    sourceText: "Hello",
    translatedText: "สวัสดีこんにちは",
  });
  const rendered = lastRendered();
  expect(rendered).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ t: "สวัสดี" }),
      expect.objectContaining({ t: "ลาก่อน" }),
    ]),
  );
  // The repaired point text is clean; the corrupted wording survives only as
  // the originalTranslation diagnostic, never as rendered text.
  expect(rendered.every((bubble) => !(bubble.t ?? "").includes("こんにちは"))).toBe(true);
});

test("unresolved contamination after the repair round reports the point without looping or deleting text", async () => {
  let translateCalls = 0;
  const reviewBodies: ReviewBody[] = [];
  const unresolved = { ...contaminatedThai, t: "กลิ่นนี่มันมีมน\u05DE\u05D4ขลังอะไรกันแน่..." };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "blob:one" || url === "blob:clean-one") return imageResponse();
    if (url === "/api/translate") {
      translateCalls += 1;
      return bubblesResponse([unresolved]);
    }
    if (url === "/api/translation-review") {
      const body = JSON.parse(String(init?.body)) as ReviewBody;
      reviewBodies.push(body);
      if (body.mode === "repair") {
        // The repair suggestion itself is still contaminated: it must never apply.
        return Response.json({
          reviews: [{ id: "0", status: "suggested", suggestion: "กลิ่นนี่มันมีมนมาขลังA" }],
        });
      }
      return Response.json({
        reviews: [{ id: "0", status: "needs_review", reason: "ตรวจพบตัวอักษรปน" }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderTranslationHook(["blob:one"]);
  await runTranslation(result);

  expect(translateCalls).toBe(1);
  // Exactly one repair round: no third provider request.
  expect(reviewBodies).toHaveLength(2);
  expect(reviewBodies[1].mode).toBe("repair");
  expect(result.current.translationResult).toContain("ภาษาอื่น");
  expect(result.current.translationResult).toContain("מה");
  expect(result.current.translationResult).toContain("1");
  // The corrupted wording is retained for repair instead of being stripped.
  const renderedText = JSON.stringify(lastRendered());
  expect(renderedText).toContain("กลิ่นนี่มันมีมน");
  expect(renderedText).toContain("\u05DE\u05D4");
});

test("zero-bubble recognition failure still retries once on the enhanced image", async () => {
  let translateCalls = 0;
  const reviewBodies: ReviewBody[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "blob:one" || url === "blob:clean-one") return imageResponse();
    if (url === "/api/translate") {
      translateCalls += 1;
      return translateCalls === 1
        ? Response.json({ text: JSON.stringify({ bubbles: [] }) })
        : bubblesResponse([cleanThai, farewell]);
    }
    if (url === "/api/translation-review") {
      const body = JSON.parse(String(init?.body)) as ReviewBody;
      reviewBodies.push(body);
      return Response.json({
        reviews: body.items.map((item) => ({ id: item.id, status: "ok" })),
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderTranslationHook(["blob:one"]);
  await runTranslation(result);

  expect(translateCalls).toBe(2);
  expect(reviewBodies).toHaveLength(1);
  const rendered = lastRendered();
  expect(rendered).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ t: "สวัสดี" }),
      expect.objectContaining({ t: "ลาก่อน" }),
    ]),
  );
});

test("contamination without source text is left unresolved without provider guesses", async () => {
  let translateCalls = 0;
  let reviewCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = String(input);
    if (url === "blob:one" || url === "blob:clean-one") return imageResponse();
    if (url === "/api/translate") {
      translateCalls += 1;
      return bubblesResponse([{ box: contaminatedThai.box, t: contaminatedThai.t }]);
    }
    if (url === "/api/translation-review") {
      reviewCalls += 1;
      return Response.json({ reviews: [{ id: "0", status: "ok" }] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderTranslationHook(["blob:one"]);
  await runTranslation(result);

  expect(translateCalls).toBe(1);
  // No source-backed evidence means the provider is never asked to guess.
  expect(reviewCalls).toBe(0);
  expect(lastRendered()?.[0]?.t).toBe(contaminatedThai.t);
  expect(result.current.translationResult).toContain("ภาษาอื่น");
});

test("opening saved work inspects locally without network calls or text rewrite", async () => {
  const savedBubble = { ...contaminatedThai };
  vi.mocked(loadProjectSession).mockResolvedValue({
    pages: [{ id: "stable", url: "blob:one", name: "page" }],
    currentPage: 0,
    updatedAt: 1,
    hasUnrecoverableSources: false,
    bubbleCache: new Map([["blob:one", [savedBubble]]]),
    translatedImageCache: new Map([["blob:one", "data:old-bitmap"]]),
    pageTargetCache: new Map([["blob:one", createPageTargetIdentity("th")!]]),
  });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(imageResponse());
  const { result } = renderTranslationHook(["blob:one"]);
  await act(async () => {
    await result.current.restoreSavedSession();
  });

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(result.current.bubbleCacheRef.current.get("blob:one")?.[0].t).toBe(contaminatedThai.t);
});
