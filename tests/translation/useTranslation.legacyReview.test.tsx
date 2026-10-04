import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { loadProjectSession } from "@/lib/projectStore";
import { createPageTargetIdentity } from "@/lib/translation/pageEligibility";
import { LANGUAGE_POLICY_VERSION } from "@/lib/languagePolicy";
import { undoManager } from "@/lib/undoManager";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      _viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
    ) => {
      onComplete?.("data:rendered");
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

const PAGE_A = "blob:page-a";
const PAGE_B = "blob:page-b";
const PAGE_C = "blob:page-c";
const PAGES = [PAGE_A, PAGE_B, PAGE_C];

interface ReviewBody {
  mode?: string;
  items: Array<{ id: string; sourceText: string; translatedText: string }>;
}

const box = [100, 100, 300, 200];
const contaminatedHello = (text: string) => ({ box, t: text, original_text: "Hello" });

// Fresh deep state per test: the hook mutates bubble objects in place.
const makeLegacySession = () => ({
  pages: [
    { id: "a", url: PAGE_A, name: "A" },
    { id: "b", url: PAGE_B, name: "B" },
    { id: "c", url: PAGE_C, name: "C" },
  ],
  currentPage: 0,
  updatedAt: 1,
  hasUnrecoverableSources: false,
  bubbleCache: new Map([
    [PAGE_A, [contaminatedHello("สวัสดีA"), { box, t: "ลาก่อน", original_text: "Goodbye" }]],
    [PAGE_B, [contaminatedHello("สวัสดีB")]],
    [PAGE_C, [contaminatedHello("สวัสดีC")]],
  ]),
  translatedImageCache: new Map(),
  // Only PAGE_B ever recorded a target: A and C are legacy pages that must be
  // confirmed once before local checks mean anything.
  pageTargetCache: new Map([[PAGE_B, createPageTargetIdentity("ja")!]]),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  undoManager.clear();
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
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
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
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,c2xpY2U=");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function renderTranslationHook() {
  return renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: PAGES,
      viewMode: "single",
      preparePageForTranslation: vi.fn().mockResolvedValue({
        recognitionUrl: PAGE_A,
        backgroundUrl: "blob:clean",
      }),
    }),
  );
}

async function restoreLegacyBook() {
  vi.mocked(loadProjectSession).mockResolvedValue(makeLegacySession());
  const hook = renderTranslationHook();
  await act(async () => {
    await hook.result.current.restoreSavedSession();
  });
  return hook;
}

test("legacy projects confirm target once with Thai suggested and retain recorded page targets", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["x"])));
  const { result } = await restoreLegacyBook();

  // Opening saved work runs local inspection only: no provider requests, no rewrites.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(result.current.bubbleCacheRef.current.get(PAGE_A)?.[0].t).toBe("สวัสดีA");
  expect(result.current.inspectLegacyTargets().map((page) => page.pageUrl)).toEqual([PAGE_A, PAGE_C]);

  // Thai is the suggested first-use confirmation (next-job selector default).
  let assigned = 0;
  act(() => {
    assigned = result.current.confirmLegacyTarget();
  });
  expect(assigned).toBe(2);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(result.current.getPageTargetLanguage(PAGE_A)).toBe("th");
  expect(result.current.getPageTargetLanguage(PAGE_C)).toBe("th");
  // A page with its own recorded target keeps it.
  expect(result.current.getPageTargetLanguage(PAGE_B)).toBe("ja");
  expect(result.current.inspectLegacyTargets()).toHaveLength(0);

  // Next-job selector changes never relabel saved pages.
  act(() => {
    result.current.setTargetLang("Japanese");
  });
  expect(result.current.getPageTargetLanguage(PAGE_A)).toBe("th");
  expect(result.current.getPageTargetLanguage(PAGE_B)).toBe("ja");

  // Unsupported targets fail closed.
  expect(result.current.confirmLegacyTarget("Klingon")).toBe(0);
  expect(result.current.getPageTargetLanguage(PAGE_A)).toBe("th");
});

test("absent and stale review metadata are locally checked and script failures cannot be human-confirmed", async () => {
  vi.mocked(loadProjectSession).mockResolvedValue({
    pages: [
      { id: "a", url: PAGE_A, name: "A" },
      { id: "c", url: PAGE_C, name: "C" },
    ],
    currentPage: 0,
    updatedAt: 1,
    hasUnrecoverableSources: false,
    bubbleCache: new Map([
      [
        PAGE_A,
        [
          { box, t: "สวัสดี", original_text: "Hello" },
          {
            box,
            t: "สวัสดีמה",
            original_text: "Hello",
            // Even a recorded approval cannot mask a detectable script failure.
            translationReview: { status: "accepted", sourceText: "Hello", reviewedText: "สวัสดีמה" },
          },
          {
            box,
            t: "ลาก่อน",
            original_text: "Goodbye",
            translationReview: { status: "unavailable", sourceText: "Goodbye", reviewedText: "ลาก่อน" },
          },
          { box, t: "ไปกันเถอะ" },
        ],
      ],
      [PAGE_C, [{ box, t: "สวัสดีC", original_text: "Hello" }]],
    ]),
    translatedImageCache: new Map(),
    pageTargetCache: new Map([[PAGE_A, createPageTargetIdentity("th")!]]),
  });
  const { result } = renderTranslationHook();
  await act(async () => {
    await result.current.restoreSavedSession();
  });

  const issues = result.current.inspectReviewIssues();
  expect(issues).toHaveLength(2);
  const pageA = issues.find((page) => page.pageUrl === PAGE_A)!;
  expect(pageA.targetUnconfirmed).toBe(false);
  // The detectable script failure is listed with its offending characters and is
  // never human-confirmable, even though its snapshot says "accepted".
  expect(pageA.scriptIssues).toHaveLength(1);
  expect(pageA.scriptIssues[0]).toMatchObject({ index: 1, kind: "script", humanConfirmable: false });
  expect(pageA.scriptIssues[0].characters).toContain("מה");
  expect(pageA.unverified).toHaveLength(3);
  expect(pageA.unverified.find((point) => point.index === 0)).toMatchObject({
    kind: "unverified",
    hasSource: true,
    humanConfirmable: true,
  });
  expect(pageA.unverified.find((point) => point.index === 2)).toMatchObject({
    status: "unavailable",
    humanConfirmable: true,
  });
  expect(pageA.unverified.find((point) => point.index === 3)).toMatchObject({
    hasSource: false,
    humanConfirmable: false,
  });
  // A legacy page without a recorded target is unconfirmed, not guessable.
  const pageC = issues.find((page) => page.pageUrl === PAGE_C)!;
  expect(pageC.targetUnconfirmed).toBe(true);
  expect(pageC.unverified[0]).toMatchObject({ humanConfirmable: false });

  // Detectable script failures can never be confirmed or dismissed past.
  expect(result.current.confirmPointReview(PAGE_A, 1)).toBe(false);
  expect(result.current.bubbleCacheRef.current.get(PAGE_A)![1].translationReview!.status).toBe("accepted");
  expect(result.current.inspectReviewIssues().find((page) => page.pageUrl === PAGE_A)!.scriptIssues).toHaveLength(1);

  // Human confirmation is source-backed: no source evidence, no confirmation.
  expect(result.current.confirmPointReview(PAGE_A, 3)).toBe(false);
  // Unconfirmed legacy pages cannot be confirmed point-by-point either.
  expect(result.current.confirmPointReview(PAGE_C, 0)).toBe(false);

  // Script passes + source present: explicit human confirmation binds an exact snapshot.
  expect(result.current.confirmPointReview(PAGE_A, 0)).toBe(true);
  const confirmed = result.current.bubbleCacheRef.current.get(PAGE_A)![0].translationReview!;
  expect(confirmed).toMatchObject({
    status: "accepted",
    sourceText: "Hello",
    reviewedText: "สวัสดี",
    targetId: "th",
    policyVersion: LANGUAGE_POLICY_VERSION,
    sourceRevision: expect.any(String),
  });
  expect(result.current.inspectReviewIssues().find((page) => page.pageUrl === PAGE_A)!.unverified.map((point) => point.index)).toEqual([2, 3]);

  // Exact snapshots control validity: editing the text invalidates the confirmation.
  const bubble = result.current.bubbleCacheRef.current.get(PAGE_A)![0];
  act(() => {
    bubble.t = "สวัสดีจ้า";
    bubble.translated = "สวัสดีจ้า";
  });
  expect(result.current.inspectReviewIssues().find((page) => page.pageUrl === PAGE_A)!.unverified.some((point) => point.index === 0)).toBe(true);
});

test("whole-book repair fixes only affected points with bounded rounds, no retranslation, and Undo/Redo retaining pre-repair text", async () => {
  const { result } = await restoreLegacyBook();
  // Legacy pages are confirmed once (Thai suggested) before repair; PAGE_B keeps its own ja target.
  act(() => {
    result.current.confirmLegacyTarget();
  });
  const reviewBodies: (ReviewBody & { targetLang?: string })[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) !== "/api/translation-review") {
      throw new Error(`whole-book repair must not retranslate: ${String(input)}`);
    }
    const body = JSON.parse(String(init?.body)) as ReviewBody & { targetLang?: string };
    reviewBodies.push(body);
    // The replacement must be in the page's own recorded target language.
    const replacement = body.targetLang === "ja" ? "こんにちは" : "สวัสดี";
    if (body.mode === "repair") {
      return Response.json({
        reviews: body.items.map((item) => ({ id: item.id, status: "suggested", suggestion: replacement })),
      });
    }
    return Response.json({ reviews: body.items.map((item) => ({ id: item.id, status: "needs_review" })) });
  });

  let summary: Awaited<ReturnType<typeof result.current.repairWholeBook>>;
  await act(async () => {
    summary = await result.current.repairWholeBook();
  });

  // Only affected points participate; every targeted contaminated page is repaired
  // under its own recorded target label.
  expect(reviewBodies).toHaveLength(6);
  expect(reviewBodies[0]).toMatchObject({ targetLang: "th", items: [{ id: "0", sourceText: "Hello", translatedText: "สวัสดีA" }] });
  expect(reviewBodies[1].mode).toBe("repair");
  expect(reviewBodies[2]).toMatchObject({ targetLang: "ja", items: [{ id: "0", sourceText: "Hello", translatedText: "สวัสดีB" }] });
  expect(reviewBodies[4]).toMatchObject({ targetLang: "th", items: [{ id: "0", sourceText: "Hello", translatedText: "สวัสดีC" }] });
  expect(summary!).toMatchObject({ pagesRepaired: 3, pointsRepaired: 3, cancelled: false, skipped: [] });

  const pageA = result.current.bubbleCacheRef.current.get(PAGE_A)!;
  expect(pageA[0].t).toBe("สวัสดี");
  expect(pageA[0].translationReview).toMatchObject({ status: "ok", originalTranslation: "สวัสดีA" });
  // Unrelated point text is untouched.
  expect(pageA[1].t).toBe("ลาก่อน");
  expect(result.current.bubbleCacheRef.current.get(PAGE_B)![0].t).toBe("こんにちは");

  // Undo retains the pre-repair text; unrelated edits survive undo and redo.
  act(() => {
    pageA[1].t = "แก้ด้วยมือ";
    pageA[1].translated = "แก้ด้วยมือ";
  });
  act(() => {
    expect(undoManager.undo()).not.toBeNull();
  });
  expect(pageA[0].t).toBe("สวัสดีA");
  expect(result.current.bubbleCacheRef.current.get(PAGE_B)![0].t).toBe("สวัสดีB");
  expect(result.current.bubbleCacheRef.current.get(PAGE_C)![0].t).toBe("สวัสดีC");
  expect(pageA[1].t).toBe("แก้ด้วยมือ");
  act(() => {
    expect(undoManager.redo()).not.toBeNull();
  });
  expect(pageA[0].t).toBe("สวัสดี");
  expect(result.current.bubbleCacheRef.current.get(PAGE_B)![0].t).toBe("こんにちは");
  expect(result.current.bubbleCacheRef.current.get(PAGE_C)![0].t).toBe("สวัสดี");
  expect(pageA[1].t).toBe("แก้ด้วยมือ");
});

test("whole-book repair skips unconfirmed legacy pages instead of guessing their language", async () => {
  const { result } = await restoreLegacyBook();
  // No target confirmation: only PAGE_B has a recorded target (ja).
  const reviewBodies: (ReviewBody & { targetLang?: string })[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) !== "/api/translation-review") throw new Error(`unexpected fetch: ${String(input)}`);
    const body = JSON.parse(String(init?.body)) as ReviewBody & { targetLang?: string };
    reviewBodies.push(body);
    if (body.mode === "repair") {
      return Response.json({
        reviews: body.items.map((item) => ({ id: item.id, status: "suggested", suggestion: "こんにちは" })),
      });
    }
    return Response.json({ reviews: body.items.map((item) => ({ id: item.id, status: "needs_review" })) });
  });

  let summary: Awaited<ReturnType<typeof result.current.repairWholeBook>>;
  await act(async () => {
    summary = await result.current.repairWholeBook();
  });

  expect(reviewBodies).toHaveLength(2);
  expect(reviewBodies[0].targetLang).toBe("ja");
  expect(summary!.skipped).toEqual([
    { pageIndex: 0, pageUrl: PAGE_A, reason: "target-unconfirmed" },
    { pageIndex: 2, pageUrl: PAGE_C, reason: "target-unconfirmed" },
  ]);
  // Unconfirmed pages keep their saved text untouched.
  expect(result.current.bubbleCacheRef.current.get(PAGE_A)![0].t).toBe("สวัสดีA");
  expect(result.current.bubbleCacheRef.current.get(PAGE_C)![0].t).toBe("สวัสดีC");
  expect(result.current.bubbleCacheRef.current.get(PAGE_B)![0].t).toBe("こんにちは");
});

test("a whole-book repair suggestion that is still contaminated stays unresolved without looping", async () => {
  const session = makeLegacySession();
  vi.mocked(loadProjectSession).mockResolvedValue({
    ...session,
    bubbleCache: new Map([[PAGE_A, [contaminatedHello("สวัสดีA")]]]),
    pageTargetCache: new Map([[PAGE_A, createPageTargetIdentity("th")!]]),
  });
  const { result } = renderTranslationHook();
  await act(async () => {
    await result.current.restoreSavedSession();
  });
  const reviewBodies: ReviewBody[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) !== "/api/translation-review") throw new Error(`unexpected fetch: ${String(input)}`);
    const body = JSON.parse(String(init?.body)) as ReviewBody;
    reviewBodies.push(body);
    if (body.mode === "repair") {
      return Response.json({
        reviews: body.items.map((item) => ({ id: item.id, status: "suggested", suggestion: "แก้A" })),
      });
    }
    return Response.json({ reviews: body.items.map((item) => ({ id: item.id, status: "needs_review" })) });
  });

  let summary: Awaited<ReturnType<typeof result.current.repairWholeBook>>;
  await act(async () => {
    summary = await result.current.repairWholeBook();
  });

  // Exactly one review + one repair round; the contaminated suggestion never applies.
  expect(reviewBodies).toHaveLength(2);
  expect(reviewBodies[1].mode).toBe("repair");
  expect(result.current.bubbleCacheRef.current.get(PAGE_A)![0].t).toBe("สวัสดีA");
  expect(summary!).toMatchObject({ pagesRepaired: 0, pointsRepaired: 0, cancelled: false });
  expect(summary!.unresolved).toEqual([{ pageIndex: 0, pageUrl: PAGE_A, points: 1 }]);
});

test("whole-book repair cancellation keeps completed pages and stops remaining work", async () => {
  const { result } = await restoreLegacyBook();
  act(() => {
    result.current.confirmLegacyTarget();
  });
  const reviewBodies: (ReviewBody & { targetLang?: string })[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) !== "/api/translation-review") throw new Error(`unexpected fetch: ${String(input)}`);
    const body = JSON.parse(String(init?.body)) as ReviewBody & { targetLang?: string };
    reviewBodies.push(body);
    if (reviewBodies.length === 3) {
      // Cancel during PAGE_B's review round.
      result.current.cancelWholeBookRepair();
    }
    if (body.mode === "repair") {
      return Response.json({
        reviews: body.items.map((item) => ({ id: item.id, status: "suggested", suggestion: "สวัสดี" })),
      });
    }
    return Response.json({ reviews: body.items.map((item) => ({ id: item.id, status: "needs_review" })) });
  });

  let summary: Awaited<ReturnType<typeof result.current.repairWholeBook>>;
  await act(async () => {
    summary = await result.current.repairWholeBook();
  });

  expect(reviewBodies).toHaveLength(3);
  expect(summary!.cancelled).toBe(true);
  expect(summary!.pagesRepaired).toBe(1);
  expect(result.current.bubbleCacheRef.current.get(PAGE_A)![0].t).toBe("สวัสดี");
  // The page after cancellation keeps its saved contaminated text.
  expect(result.current.bubbleCacheRef.current.get(PAGE_B)![0].t).toBe("สวัสดีB");
});
