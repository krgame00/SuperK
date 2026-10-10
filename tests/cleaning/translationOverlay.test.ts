import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  applyTranslationOverlay,
  downloadTranslatedImage,
  type TranslatedBubble,
} from "@/lib/translationOverlay";
import { undoManager } from "@/lib/undoManager";

test("translation overlay contains no browser-side inpainting", () => {
  const source = readFileSync("lib/translationOverlay.ts", "utf8");
  expect(source).not.toContain("cv.worker");
  expect(source).not.toContain("inpainted-bg");
  expect(source).not.toMatch(/brightness\s*[<>]/);
  expect(source).toContain('className = "tl-canvas"');
});

let fillTextSpy: ReturnType<typeof vi.fn<CanvasRenderingContext2D["fillText"]>>;
let strokeTextSpy: ReturnType<typeof vi.fn<CanvasRenderingContext2D["strokeText"]>>;
let lineWidths: number[];
let shadowColors: string[];
let shadowBlurs: number[];
let shadowOffsetsX: number[];
let shadowOffsetsY: number[];
let drawnFillColors: string[];
let drawnOutlineColors: string[];
let fontAwareMeasureTextCount: number;

beforeEach(() => {
  vi.useFakeTimers();
  undoManager.clear();

  const storageValues = new Map<string, string>();
  const storage: Storage = {
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
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  fillTextSpy = vi.fn<CanvasRenderingContext2D["fillText"]>();
  strokeTextSpy = vi.fn<CanvasRenderingContext2D["strokeText"]>();
  lineWidths = [];
  shadowColors = [];
  shadowBlurs = [];
  shadowOffsetsX = [];
  shadowOffsetsY = [];
  drawnFillColors = [];
  drawnOutlineColors = [];
  fontAwareMeasureTextCount = 0;

  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  });

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {
        measureText: () => ({ width: 20 }),
        fillText: function(this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D["fillText"]>) {
          drawnFillColors.push(String(this.fillStyle));
          fillTextSpy(...args);
        },
        strokeText: function(this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D["strokeText"]>) {
          drawnOutlineColors.push(String(this.strokeStyle));
          strokeTextSpy(...args);
        },
        clearRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      },
      {
        get(target, property) {
          if (property in target) {
            return target[property as keyof typeof target];
          }
          return vi.fn();
        },
        set(target, property, value) {
          if (property === "lineWidth" && typeof value === "number") lineWidths.push(value);
          if (property === "shadowColor" && typeof value === "string") shadowColors.push(value);
          if (property === "shadowBlur" && typeof value === "number") shadowBlurs.push(value);
          if (property === "shadowOffsetX" && typeof value === "number") shadowOffsetsX.push(value);
          if (property === "shadowOffsetY" && typeof value === "number") shadowOffsetsY.push(value);
          return Reflect.set(target as Record<PropertyKey, unknown>, property, value);
        },
      },
    ) as unknown as CanvasRenderingContext2D,
  );

  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,dHJhbnNsYXRlZA==",
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function renderOverlay(
  text = "ข้อความแปล",
  bubbleOverrides: Partial<TranslatedBubble> = {},
  options: {
    pageKeyOverride?: string;
    onBubblesMutated?: () => void;
  } = {},
) {
  const viewport = document.createElement("div");
  const container = document.createElement("div");
  const chromeRoot = document.createElement("div");
  chromeRoot.setAttribute("data-overlay-chrome-layer", "true");
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1000 },
    naturalHeight: { configurable: true, value: 1200 },
  });
  container.appendChild(image);
  viewport.appendChild(container);
  viewport.appendChild(chromeRoot);
  document.body.appendChild(viewport);

  const bubble: TranslatedBubble = {
    box: [100, 100, 300, 400],
    t: text,
    ...bubbleOverrides,
  };
  await applyTranslationOverlay(
    [bubble],
    "single",
    0,
    vi.fn(),
    undefined,
    {
      current: {
        fontFamily: "Itim, sans-serif",
        textColor: "#000000",
        textOutline: "#ffffff",
        fontSizeMultiplier: 1,
      },
    },
    container,
    options.pageKeyOverride,
    options.onBubblesMutated, (/[A-Za-z]/.test(text) && !/\p{Script=Thai}/u.test(text) ? "en" : "th"),
  );
  await vi.runAllTimersAsync();

  const wrapper = container.querySelector<HTMLElement>(".translation-bubble-wrapper")!;
  const canvas = wrapper.querySelector<HTMLCanvasElement>("canvas")!;
  const toolbar = chromeRoot.querySelector<HTMLElement>(".bubble-quick-toolbar")!;

  return { viewport, container, chromeRoot, wrapper, canvas, toolbar, bubble };
}

describe("translation quality review editor", () => {
  test("a legacy contaminated suggestion cannot be accepted", async () => {
    const savedReview={status:"suggested" as const,sourceText:"Hello",reviewedText:"สวัสดี",suggestion:"สวัสดีמה"};
    const {wrapper,bubble,chromeRoot}=await renderOverlay("สวัสดี",{original_text:"Hello",translationReview:{...savedReview}});
    wrapper.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
    const editor=chromeRoot.querySelector<HTMLElement>("[data-translation-editor]")!;
    expect(editor.textContent).toContain("พบตัวอักษรภาษาอื่นปน");
    const accept=editor.querySelector<HTMLButtonElement>('[data-review-action="accept"]')!;
    expect(accept.disabled).toBe(true);
    accept.click(); expect(bubble.t).toBe("สวัสดี");
    expect(bubble.translationReview).toEqual(savedReview);
  });
  test.each([undefined,{status:"ok" as const,sourceText:"",reviewedText:"คำแปลเดิม"}])("a saved mixed translation shows current offending characters despite old metadata: %j", async oldReview => {
    const text="กลิ่นนี่มันมีมนמהขลังอะไรกันแน่...";
    const {wrapper,bubble,chromeRoot}=await renderOverlay(text,{translationReview:oldReview});
    wrapper.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
    expect(chromeRoot.querySelector<HTMLElement>("[data-translation-editor]")!.textContent).toContain("מה");
    expect(bubble.t).toBe(text);
  });
  const review = { status: "suggested" as const, sourceText: "Hello, friend.", reviewedText: "สวัสดี", suggestion: "สวัสดี เพื่อน", reason: "The greeting names a friend." };
  async function openReview() {
    const result = await renderOverlay("สวัสดี", { original_text: review.sourceText, translationReview: { ...review } });
    result.wrapper.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = result.chromeRoot.querySelector<HTMLElement>("[data-translation-editor]")!;
    const action = (name: string) => editor.querySelector<HTMLButtonElement>(`[data-review-action="${name}"]`)!;
    const save = () => editor.querySelector<HTMLButtonElement>('[aria-label="บันทึกข้อความ"]')!.click();
    const cancel = () => editor.querySelector<HTMLButtonElement>('[aria-label="ยกเลิกการแก้ไข"]')!.click();
    return { ...result, editor, action, save, cancel };
  }
  test("shows source and reason without automatically replacing the translation", async () => {
    const { editor, bubble } = await openReview();
    expect(editor.textContent).toContain(review.sourceText);
    expect(editor.textContent).toContain(review.reason);
    expect(editor.textContent).toContain(review.suggestion);
    expect(bubble.t).toBe(review.reviewedText);
  });
  test("accepts only by choice and restores text and review together through Undo/Redo", async () => {
    const { action, save, bubble } = await openReview();
    action("accept").click();
    expect(bubble.t).toBe(review.suggestion);
    expect(bubble.translationReview).toMatchObject({ status: "accepted", originalTranslation: review.reviewedText, reviewedText: review.suggestion });
    save();
    undoManager.undo();
    expect(bubble.t).toBe(review.reviewedText);
    expect(bubble.translationReview).toEqual(review);
    undoManager.redo();
    expect(bubble.t).toBe(review.suggestion);
    expect(bubble.translationReview?.status).toBe("accepted");
  });
  test("records a metadata-only dismissal in Undo/Redo", async () => {
    const { action, save, bubble } = await openReview();
    action("dismiss").click();
    save();
    expect(bubble.translationReview?.status).toBe("dismissed");
    undoManager.undo();
    expect(bubble.translationReview).toEqual(review);
    undoManager.redo();
    expect(bubble.translationReview?.status).toBe("dismissed");
  });
  test("cancel restores review metadata after accepting or typing", async () => {
    const { action, cancel, bubble, editor } = await openReview();
    action("accept").click();
    const input = editor.querySelector("textarea")!;
    input.value = "changed";
    input.dispatchEvent(new Event("input"));
    expect(bubble.translationReview?.status).toBe("stale");
    cancel();
    expect(bubble.t).toBe(review.reviewedText);
    expect(bubble.translationReview).toEqual(review);
    expect(undoManager.canUndo()).toBe(false);
  });
  test("disables stale suggestions and checks snapshots again at click time", async () => {
    const { action, bubble, editor } = await openReview();
    bubble.original_text = "Goodbye.";
    action("accept").click();
    expect(bubble.t).toBe(review.reviewedText);
    expect(bubble.translationReview?.status).toBe("stale");
    const input = editor.querySelector("textarea")!;
    input.value = "changed";
    input.dispatchEvent(new Event("input"));
    expect(action("accept").disabled).toBe(true);
    expect(action("dismiss").disabled).toBe(true);
  });
  test("can restore the translation that preceded an accepted suggestion", async () => {
    const { action, bubble } = await openReview();
    action("accept").click();
    action("restore").click();
    expect(bubble.t).toBe(review.reviewedText);
    expect(bubble.translationReview).toMatchObject({ status: "suggested", reviewedText: review.reviewedText, originalTranslation: review.reviewedText });
  });
  test("cancel preserves the exact opening text snapshot including whitespace", async () => {
    const original = " สวัสดี ";
    const { wrapper, chromeRoot, bubble } = await renderOverlay(original, {
      original_text: review.sourceText,
      translationReview: { ...review, reviewedText: original },
    });
    wrapper.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    chromeRoot.querySelector<HTMLButtonElement>('[aria-label="ยกเลิกการแก้ไข"]')!.click();
    expect(bubble.t).toBe(original);
    expect(bubble.translationReview?.reviewedText).toBe(original);
  });
  test("moving focus to a review button keeps the editor open until Save", async () => {
    const { editor, action, bubble, save } = await openReview();
    action("accept").focus();
    await vi.runAllTimersAsync();
    expect(editor.isConnected).toBe(true);
    action("accept").click();
    expect(editor.isConnected).toBe(true);
    expect(bubble.t).toBe(review.suggestion);
    save();
    expect(editor.isConnected).toBe(false);
  });
});

describe("translation overlay live editor and keyboard controls", () => {
  test("cycles B&W contrast modes (black_on_white -> white_on_black -> pure_black -> auto) from the floating toolbar with undo/redo", async () => {
    const { toolbar, bubble } = await renderOverlay("TEST", {styleProfile:{
      source:"auto", category:"dialogue", fill:"#000000", outline:"#ffffff", backgroundLuminance:250,
    }});
    const bwBtn = toolbar.querySelector<HTMLButtonElement>('[aria-label="สลับโหมดสี ขาว-ดำ / ดำ-ขาว"]')!;
    expect(bwBtn).not.toBeNull();

    // 1st click -> black_on_white
    bwBtn.click();
    expect(bubble.styleProfile?.bwContrastMode).toBe("black_on_white");
    expect(bwBtn.getAttribute("aria-label")).toBe("โหมดขาว-ดำ: ดำ-ขาว (ตัวดำ ขอบขาวหนา)");
    expect(drawnFillColors.at(-1)).toBe("#000000");
    expect(drawnOutlineColors.at(-1)).toBe("#ffffff");

    // 2nd click -> white_on_black
    bwBtn.click();
    expect(bubble.styleProfile?.bwContrastMode).toBe("white_on_black");
    expect(bwBtn.getAttribute("aria-label")).toBe("โหมดขาว-ดำ: ขาว-ดำ (ตัวขาว ขอบดำหนา)");
    expect(drawnFillColors.at(-1)).toBe("#ffffff");
    expect(drawnOutlineColors.at(-1)).toBe("#000000");

    // 3rd click -> pure_black
    bwBtn.click();
    expect(bubble.styleProfile?.bwContrastMode).toBe("pure_black");
    expect(bwBtn.getAttribute("aria-label")).toBe("โหมดขาว-ดำ: ดำล้วน");

    // 4th click -> auto
    bwBtn.click();
    expect(bubble.styleProfile?.bwContrastMode).toBe("auto");
    expect(bwBtn.getAttribute("aria-label")).toBe("โหมดขาว-ดำ: ออโต้");
  });

  test.each(["single", "offscreen"] as const)("draws white Auto interiors and source colored outlines in the %s canvas", async (mode) => {
    const container = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 1200 },
    });
    container.appendChild(image);
    document.body.appendChild(container);
    const sourceProfile = { source: "auto" as const, evidenceState: "admitted" as const,
      fill: "#930a0b", outline: "#ffffff", hasOutline: false, outlineWidthRatio: 0,
      fillConfidence: .95, outlineConfidence: 0, backgroundLuminance: 180 };
    await applyTranslationOverlay([{ box: [100, 100, 300, 400], t: "ข้อความ", styleProfile: sourceProfile }],
      mode, 0, vi.fn(), undefined, undefined, container, undefined, undefined, "th");
    await vi.runAllTimersAsync();
    expect(drawnFillColors.length).toBeGreaterThan(0);
    expect(drawnFillColors.every(color => color === "#ffffff")).toBe(true);
    expect(drawnOutlineColors).toContain("#930a0b");
    expect(shadowColors).toContain("rgba(30, 30, 30, 0.3)");
    expect(sourceProfile.fill).toBe("#930a0b");
    expect(sourceProfile.hasOutline).toBe(false);
  });

  test("uses an explicit container for overlay and export", async () => {
    const decoy = document.createElement("div");
    decoy.id = "offscreen-container";
    document.body.appendChild(decoy);

    const explicitContainer = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 1200 },
    });
    explicitContainer.appendChild(image);
    document.body.appendChild(explicitContainer);

    const onComplete = vi.fn();
    await applyTranslationOverlay(
      [{ box: [100, 100, 300, 400], t: "สวัสดี" }],
      "offscreen",
      0,
      vi.fn(),
      onComplete,
      {
        current: {
          fontFamily: "Itim, sans-serif",
          textColor: "#000000",
          textOutline: "#ffffff",
          fontSizeMultiplier: 1,
        },
      },
      explicitContainer, undefined, undefined, "th",
    );
    await vi.runAllTimersAsync();

    expect(explicitContainer.querySelector(".tl-canvas")).not.toBeNull();
    expect(decoy.querySelector(".tl-canvas")).toBeNull();
    expect(onComplete).toHaveBeenCalledWith(
      "data:image/jpeg;base64,dHJhbnNsYXRlZA==",
    );
    expect(
      downloadTranslatedImage(
        "offscreen",
        0,
        "",
        true,
        explicitContainer,
      ),
    ).toBe("data:image/jpeg;base64,dHJhbnNsYXRlZA==");
  });

  test("omits stroke rendering for an explicit manual no-outline style", async () => {
    await renderOverlay("ธรรมดา", {
      styleProfile: {
        fill: "#000000",
        outline: "#ffffff",
        hasOutline: false,
        outlineWidth: 0,
        outlineWidthRatio: 0,
        source: "manual",
        ownershipMode: "manual",
      },
    });

    expect(fillTextSpy).toHaveBeenCalled();
    expect(strokeTextSpy).not.toHaveBeenCalled();
  });

  test("scales rendered stroke width from the source-derived outline ratio", async () => {
    await renderOverlay("ขอบ", {
      styleProfile: {
        fill: "#ffffff",
        outline: "#ff1e82",
        hasOutline: true,
        outlineWidthRatio: 0.05,
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        source: "auto",
        ownershipMode: "source_faithful",
        category: "dialogue",
      },
    });
    const thinWidth = lineWidths.at(-1) ?? 0;
    expect(strokeTextSpy).toHaveBeenCalled();
    expect(thinWidth).toBeGreaterThan(0);

    lineWidths = [];
    strokeTextSpy.mockClear();
    await renderOverlay("ขอบ", {
      styleProfile: {
        fill: "#ffffff",
        outline: "#ff1e82",
        hasOutline: true,
        outlineWidthRatio: 0.20,
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        source: "auto",
        ownershipMode: "source_faithful",
        category: "dialogue",
      },
    });
    const thickWidth = lineWidths.at(-1) ?? 0;
    expect(strokeTextSpy).toHaveBeenCalled();
    expect(thickWidth).toBeGreaterThan(thinWidth * 2);
  });

  test("renders the proportional subtle shadow on automatic text and ignores source glow/shadow", async () => {
    await renderOverlay("เงามาตรฐาน", {
      styleProfile: {
        fill: "#ffffff",
        outline: "#ff3366",
        hasOutline: true,
        outlineWidthRatio: 0.12,
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        evidenceState: "admitted",
        sourceAccentColor: "#ff3366",
        source: "auto",
        ownershipMode: "auto",
        shadow: { color: "#00ff00", opacity: 1, blurRatio: 0.6, offsetXRatio: 0.4, offsetYRatio: 0.4 },
        glow: { color: "#00ffff", opacity: 1, blurRatio: 0.8, offsetXRatio: 0, offsetYRatio: 0 },
      },
    });

    expect(shadowColors.at(-1)).toBe("rgba(30, 30, 30, 0.3)");
    expect(shadowBlurs.at(-1)).toBeGreaterThan(0);
    expect(shadowOffsetsX.at(-1)).toBeGreaterThan(0);
    expect(shadowOffsetsY.at(-1)).toBeGreaterThan(0);
    expect(shadowBlurs.at(-1)! / shadowOffsetsX.at(-1)!).toBeCloseTo(0.06 / 0.025, 2);
  });

  test("keeps rendered text fully visible during hover and editing", async () => {
    const { wrapper, canvas, toolbar } = await renderOverlay();
    wrapper.dispatchEvent(new MouseEvent("mouseenter"));
    expect(canvas.style.opacity || "1").toBe("1");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    expect(canvas.style.opacity || "1").toBe("1");
    const editor = document.querySelector<HTMLElement>("[data-translation-editor]")!;
    expect(wrapper.contains(editor)).toBe(false);
  });

  test("keeps the floating toolbar minimal with only the 5 essential buttons on a single bar", async () => {
    const { toolbar } = await renderOverlay();
    const directButtons = Array.from(toolbar.children).filter(
      (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
    );
    expect(directButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "แก้ไขข้อความ",
      "ลดขนาดข้อความ (A- หรือคีย์ -)",
      "เพิ่มขนาดข้อความ (A+ หรือคีย์ +)",
      "สลับโหมดสี ขาว-ดำ / ดำ-ขาว",
      "ลบกล่องข้อความ",
    ]);
    expect(toolbar.querySelector('[aria-label="ทำซ้ำกล่องข้อความ"]')).toBeNull();
    expect(toolbar.querySelector('[aria-label="คัดลอกข้อความ"]')).toBeNull();
    expect(toolbar.querySelector('[aria-label="เปลี่ยนสีข้อความ"]')).toBeNull();
    expect(toolbar.querySelector('[aria-label="เครื่องมือเพิ่มเติม"]')).toBeNull();
    expect(document.querySelector("[data-bubble-more-menu]")).toBeNull();
  });

  test("renders editor chrome in the dedicated unscaled chrome layer", async () => {
    const { container, chromeRoot, wrapper, toolbar } = await renderOverlay();
    const moveHandle = chromeRoot.querySelector<HTMLElement>(".action-handle--move")!;

    expect(container.contains(toolbar)).toBe(false);
    expect(wrapper.contains(toolbar)).toBe(false);
    expect(toolbar.parentElement).toBe(chromeRoot);
    expect(moveHandle.parentElement).toBe(chromeRoot);
    expect(toolbar.style.getPropertyValue("scale")).toBe("");
    expect(moveHandle.style.getPropertyValue("scale")).toBe("");

    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    const editor = document.querySelector<HTMLElement>("[data-translation-editor]")!;
    expect(editor.parentElement).toBe(chromeRoot);
    expect(editor.style.getPropertyValue("scale")).toBe("");
  });

  test("anchors toolbar and handles to the bubble screen rect", async () => {
    const { chromeRoot, wrapper, toolbar } = await renderOverlay();
    chromeRoot.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 900,
      bottom: 700,
      width: 900,
      height: 700,
      toJSON: () => ({}),
    } as DOMRect));
    wrapper.getBoundingClientRect = vi.fn(() => ({
      x: 200,
      y: 150,
      left: 200,
      top: 150,
      right: 320,
      bottom: 230,
      width: 120,
      height: 80,
      toJSON: () => ({}),
    } as DOMRect));
    // Chrome includes an element's own zoom in offsetWidth/offsetHeight.
    Object.defineProperty(toolbar, "offsetWidth", {
      configurable: true,
      get: () => 286 * (Number(toolbar.style.zoom) || 1),
    });
    Object.defineProperty(toolbar, "offsetHeight", {
      configurable: true,
      get: () => 46 * (Number(toolbar.style.zoom) || 1),
    });

    wrapper.focus();

    // The 120×80 bubble floors chromeScale at 0.6; written offsets are
    // pre-divided so the zoomed chrome lands on the bubble's screen rect.
    expect(toolbar.style.left).toBe(`${260 / 0.6}px`);
    const frame = wrapper.querySelector<HTMLElement>(".bubble-text-selection")!;
    const left = 200 + 120 * parseFloat(frame.style.left) / 100;
    const top = 150 + 80 * parseFloat(frame.style.top) / 100;
    const right = left + 120 * parseFloat(frame.style.width) / 100;
    const bottom = top + 80 * parseFloat(frame.style.height) / 100;
    expect(parseFloat(toolbar.style.top)).toBeCloseTo((top - 10) / .6);
    expect(toolbar.style.transform).toBe("translate(-50%, -100%)");

    const rotate = chromeRoot.querySelector<HTMLElement>(".action-handle--rotate")!;
    const scale = chromeRoot.querySelector<HTMLElement>(".action-handle--scale")!;
    const width = chromeRoot.querySelector<HTMLElement>(".action-handle--width")!;
    const move = chromeRoot.querySelector<HTMLElement>(".action-handle--move")!;

    expect([rotate.style.left, rotate.style.top]).toEqual([`${left / 0.6}px`, `${top / 0.6}px`]);
    expect([scale.style.left, scale.style.top]).toEqual([`${right / 0.6}px`, `${top / 0.6}px`]);
    expect([width.style.left, width.style.top]).toEqual([`${right / 0.6}px`, `${(top + bottom) / 2 / 0.6}px`]);
    expect([move.style.left, move.style.top]).toEqual([`${left / 0.6}px`, `${bottom / 0.6}px`]);
    expect(chromeRoot.querySelector(".action-handle--width-left")).toBeNull();
  });

  test("opens a larger multiline editor with explicit save and cancel controls", async () => {
    const { toolbar } = await renderOverlay("บรรทัดแรก");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();

    const editor = document.querySelector<HTMLElement>("[data-translation-editor]")!;
    const textarea = editor.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(textarea).toBeTruthy();
    expect(textarea.style.fontSize).toBe("16px");
    expect(textarea.style.minHeight).toBe("48px");
    expect(Number.parseInt(textarea.style.minWidth, 10)).toBeGreaterThanOrEqual(300);
    expect(editor.querySelector<HTMLButtonElement>('[aria-label="บันทึกข้อความ"]')).toBeTruthy();
    expect(editor.querySelector<HTMLButtonElement>('[aria-label="ยกเลิกการแก้ไข"]')).toBeTruthy();

    textarea.value = "บรรทัดแรก\nบรรทัดสอง";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector("[data-translation-editor]")).toBeTruthy();

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
    expect(document.querySelector("[data-translation-editor]")).toBeNull();
    expect(undoManager.undo()).toBe("แก้ไขข้อความ");
  });

  test("renders every input on the real canvas and creates one undo transaction", async () => {
    const { toolbar } = await renderOverlay("เดิม");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    const input = document.querySelector<HTMLTextAreaElement>('[data-translation-editor] textarea')!;
    input.value = "ข้อความใหม่";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(fillTextSpy).toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(undoManager.undo()).toBe("แก้ไขข้อความ");
    expect(undoManager.undo()).toBeNull();
  });

  test("escape restores opening text without creating an undo record", async () => {
    const { toolbar } = await renderOverlay("ข้อความเดิม");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    const input = document.querySelector<HTMLTextAreaElement>('[data-translation-editor] textarea')!;
    input.value = "แก้ไขชั่วคราว";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(undoManager.undo()).toBeNull();
    expect(document.querySelector("[data-translation-editor]")).toBeNull();
  });

  test("moves and resizes a focused bubble in source-image pixels", async () => {
    const { wrapper } = await renderOverlay();
    const pageNavigation = vi.fn();
    window.addEventListener("keydown", pageNavigation);
    wrapper.focus();
    const leftBefore = Number.parseFloat(wrapper.style.left);
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(Number.parseFloat(wrapper.style.left)).toBeGreaterThanOrEqual(leftBefore);
    const topBefore = Number.parseFloat(wrapper.style.top);
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    expect(Number.parseFloat(wrapper.style.top)).toBeGreaterThanOrEqual(topBefore);
    const widthBefore = Number.parseFloat(wrapper.style.width);
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    expect(Number.parseFloat(wrapper.style.width)).toBeGreaterThanOrEqual(widthBefore);
    expect(pageNavigation).not.toHaveBeenCalled();
    window.removeEventListener("keydown", pageNavigation);
  });

  test("persists moved position and font size on the bubble across a page remount", async () => {
    window.localStorage.clear();
    const pageKey = `data:image/png;base64,${"A".repeat(20_000)}`;
    const onBubblesMutated = vi.fn();
    const first = await renderOverlay(
      "จำตำแหน่ง",
      {},
      { pageKeyOverride: pageKey, onBubblesMutated },
    );

    first.wrapper.focus();
    first.wrapper.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
      }),
    );
    first.toolbar
      .querySelector<HTMLButtonElement>('[aria-label^="เพิ่มขนาดข้อความ"]')!
      .click();

    const movedLeft = first.wrapper.style.left;
    const fontSizeMultiplier = first.bubble.fontSizeMultiplier;
    expect(fontSizeMultiplier).toBeGreaterThan(1);
    expect(onBubblesMutated).toHaveBeenCalled();

    const sessionRoundTrip = JSON.parse(
      JSON.stringify(first.bubble),
    ) as TranslatedBubble;
    expect(
      (sessionRoundTrip as TranslatedBubble & {
        layoutAdjustment?: { bx: number };
      }).layoutAdjustment?.bx,
    ).toBeTypeOf("number");

    window.localStorage.clear();
    first.container.remove();

    const restored = await renderOverlay(
      "จำตำแหน่ง",
      sessionRoundTrip,
      { pageKeyOverride: pageKey },
    );

    expect(restored.wrapper.style.left).toBe(movedLeft);
    expect(restored.bubble.fontSizeMultiplier).toBe(fontSizeMultiplier);
  });

  test("uses a compact localStorage key instead of embedding the full page data URL", async () => {
    window.localStorage.clear();
    const pageKey = `data:image/png;base64,${"B".repeat(20_000)}`;
    const { wrapper } = await renderOverlay(
      "คีย์สั้น",
      {},
      { pageKeyOverride: pageKey },
    );

    wrapper.focus();
    wrapper.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );

    const stored = window.localStorage.getItem("superk:overlay-adjustments");
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(pageKey);
    expect(stored!.length).toBeLessThan(2_000);
  });

  test("supports deletion and undo", async () => {
    const { wrapper, toolbar } = await renderOverlay("จะลบ");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="ลบกล่องข้อความ"]')!.click();
    expect(wrapper.style.display).toBe("none");
    expect(undoManager.undo()).toBe("ลบกล่องข้อความ");
    expect(wrapper.style.display).toBe("block");
  });

  test("chrome toolbar scales down for small bubbles and restores for large ones", async () => {
  // vitest fake timers don't fake rAF; run chrome-sync frames synchronously
  // so repositioning happens inside the test.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(16);
    return 1;
  });
  const { chromeRoot, wrapper, toolbar } = await renderOverlay("ปรับขนาดเครื่องมือ");

  // jsdom rects are zero-sized → chrome sits at the small-bubble floor.
  wrapper.dispatchEvent(new FocusEvent("focus"));
  expect(toolbar.style.zoom).toBe("0.6");
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="nw"]')!;
  expect(handle.style.zoom).toBe("0.6");

  // A large bubble keeps full-size chrome.
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
    left: 40, top: 40, right: 5040, bottom: 3040, width: 5000, height: 3000,
  } as DOMRect);
  vi.spyOn(chromeRoot, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 1200, bottom: 1600, width: 1200, height: 1600,
  } as DOMRect);
  wrapper.dispatchEvent(new FocusEvent("focus"));
  await vi.runAllTimersAsync();
  expect(toolbar.style.zoom).toBe("1");
  expect(handle.style.zoom).toBe("1");
});

test("zoomed-down chrome stays anchored on the bubble", async () => {
  // vitest fake timers don't fake rAF; run chrome-sync frames synchronously.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(16);
    return 1;
  });
  const { chromeRoot, wrapper, toolbar } = await renderOverlay("จุดยึดเครื่องมือ");

  // Chrome multiplies a zoomed element's own left/top lengths by its zoom, so
  // emulate that layout: the toolbar's measured box shrinks with its zoom.
  Object.defineProperty(toolbar, "offsetWidth", {
    configurable: true,
    get: () => 286 * (Number(toolbar.style.zoom) || 1),
  });
  Object.defineProperty(toolbar, "offsetHeight", {
    configurable: true,
    get: () => 46 * (Number(toolbar.style.zoom) || 1),
  });

  // 160×60 bubble at (0, 100) → chromeScale floors at 0.6.
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 100, right: 160, bottom: 160, width: 160, height: 60,
  } as DOMRect);
  vi.spyOn(chromeRoot, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800,
  } as DOMRect);

  wrapper.dispatchEvent(new FocusEvent("focus"));
  await vi.runAllTimersAsync();

  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="nw"]')!;
  expect(handle.style.zoom).toBe("0.6");
  // Written offsets must be pre-divided by the zoom so the rendered chrome
  // lands on the bubble instead of drifting toward the layer origin.
  expect(handle.style.left).toBe(`${0 / 0.6}px`);
  const frame = wrapper.querySelector<HTMLElement>(".bubble-text-selection")!;
  expect(parseFloat(handle.style.top) * .6).toBeCloseTo(100 + 60 * parseFloat(frame.style.top) / 100);
  const expectedCenter = Math.min(Math.max(80, (286 * 0.6) / 2 + 8), 1000 - (286 * 0.6) / 2 - 8);
  expect(Number.parseFloat(toolbar.style.left) * 0.6).toBeCloseTo(expectedCenter, 6);

  // Re-syncs must not shrink the measurement: offsetWidth already includes
  // the previous zoom, so the base width is stable at 286 across syncs.
  const firstLeft = toolbar.style.left;
  wrapper.dispatchEvent(new FocusEvent("focus"));
  await vi.runAllTimersAsync();
  expect(Number.parseFloat(toolbar.style.left) * 0.6).toBeCloseTo(expectedCenter, 6);
  expect(toolbar.style.left).toBe(firstLeft);

  // A large bubble (zoom 1) keeps raw un-divided offsets.
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
    left: 40, top: 40, right: 5040, bottom: 3040, width: 5000, height: 3000,
  } as DOMRect);
  wrapper.dispatchEvent(new FocusEvent("focus"));
  await vi.runAllTimersAsync();
  expect(parseFloat(handle.style.left)).toBeCloseTo(40 + 5000 * parseFloat(frame.style.left) / 100);
  expect(parseFloat(handle.style.top)).toBeCloseTo(40 + 3000 * parseFloat(frame.style.top) / 100);
  expect(toolbar.style.zoom).toBe("1");
});

test("excludes deleted bubbles from export compositing until undo", async () => {
    const { container, toolbar, canvas } = await renderOverlay("จะลบแล้ว export");

    const drawImageArgs: unknown[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      new Proxy(
        {
          measureText: () => ({ width: 20 }),
          drawImage: (...args: unknown[]) => {
            drawImageArgs.push(args);
          },
        },
        {
          get(target, property) {
            if (property in target) {
              return target[property as keyof typeof target];
            }
            return vi.fn();
          },
          set(target, property, value) {
            return Reflect.set(target as Record<PropertyKey, unknown>, property, value);
          },
        },
      ) as unknown as CanvasRenderingContext2D,
    );

    const drawTargetsOfExport = () => {
      drawImageArgs.length = 0;
      downloadTranslatedImage("single", 0, "export.png", true, container);
      return drawImageArgs.map((args) => args[0]);
    };

    // Baseline: the visible bubble canvas is composited.
    expect(drawTargetsOfExport()).toContain(canvas);

    toolbar.querySelector<HTMLButtonElement>('[aria-label="ลบกล่องข้อความ"]')!.click();

    // A Deleted bubble stays in the DOM (for undo) but must not be composited.
    expect(drawTargetsOfExport()).not.toContain(canvas);

    undoManager.undo();

    // Undo restores the bubble into future exports.
    expect(drawTargetsOfExport()).toContain(canvas);
  });

  test("preserves style profile across movement, resizing, and text edits", async () => {
    const profile = {
      fill: "#ff5500",
      outline: "#000000",
      hasOutline: true,
      outlineWidthRatio: 0.14,
      opacity: 0.9,
      source: "manual" as const,
      category: "sfx" as const,
      fillGradient: {
        angleDeg: 90,
        stops: [
          { offset: 0, color: "#ff5500" },
          { offset: 1, color: "#ffff00" },
        ],
      },
    };

    const { wrapper, bubble, toolbar } = await renderOverlay("สไตล์เดิม", {
      styleProfile: profile,
    });

    // Move bubble
    wrapper.focus();
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(bubble.styleProfile).toEqual(profile);

    // Resize bubble
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    expect(bubble.styleProfile).toEqual(profile);

    // Edit text
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    const input = document.querySelector<HTMLTextAreaElement>('[data-translation-editor] textarea')!;
    input.value = "ข้อความใหม่";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(bubble.styleProfile).toEqual(profile);
  });

  test("maintains workspace overlay and export parity for decorative effects and stroke", async () => {
    const { container } = await renderOverlay("เอฟเฟกต์ครบ", {
      styleProfile: {
        fill: "#ff0055",
        outline: "#111111",
        hasOutline: true,
        outlineWidthRatio: 0.18,
        source: "auto",
        fillGradient: {
          angleDeg: 90,
          stops: [
            { offset: 0, color: "#ff0055" },
            { offset: 1, color: "#ffaa00" },
          ],
        },
        shadow: {
          color: "#000000",
          opacity: 0.8,
          blurRatio: 0.2,
          offsetXRatio: 0.08,
          offsetYRatio: 0.08,
        },
      },
    });

    expect(strokeTextSpy).toHaveBeenCalled();
    expect(fillTextSpy).toHaveBeenCalled();

    // Export via downloadTranslatedImage using the exact same rendered container
    const exportedDataUrl = downloadTranslatedImage("single", 0, "export.png", true, container);
    expect(exportedDataUrl).toBe("data:image/jpeg;base64,dHJhbnNsYXRlZA==");
  });

  test("renders legacy profiles without new fields safely during workspace display and export", async () => {
    const legacyBubble: Partial<TranslatedBubble> = {
      styleProfile: {
        fill: "#0055ff",
        outline: "#ffffff",
        outlineWidth: 1.5,
        source: "auto",
      },
    };

    const { container } = await renderOverlay("โปรเจกต์เดิม", legacyBubble);
    expect(strokeTextSpy).toHaveBeenCalled();
    expect(fillTextSpy).toHaveBeenCalled();

    const exported = downloadTranslatedImage("single", 0, "legacy.png", true, container);
    expect(exported).toBeTruthy();
  });

  test("renders confirmed monochrome dialogue without a canvas shadow and color page dialogue without a shadow", async () => {
    await renderOverlay("ข้อความขาวดำ", {
      styleProfile: {
        fill: "#000000",
        outline: "#ffffff",
        source: "auto",
        ownershipMode: "auto",
        category: "dialogue",
        isMonochromePage: true,
        monochromeConfidence: 0.98,
        backgroundLuminance: 245,
      },
    });

    expect(shadowBlurs.at(-1) ?? 0).toBe(0);
    expect(shadowOffsetsX.at(-1) ?? 0).toBe(0);

    // Color-page dialogue also remains clean
    await renderOverlay("ข้อความสี", {
      styleProfile: {
        fill: "#000000",
        outline: "#ffffff",
        source: "auto",
        ownershipMode: "auto",
        category: "dialogue",
        isMonochromePage: false,
        monochromeConfidence: 0.98,
        backgroundLuminance: 245,
      },
    });

    expect(shadowBlurs.at(-1) ?? 0).toBe(0);
    expect(shadowOffsetsX.at(-1) ?? 0).toBe(0);
  });
});
test("regression: keyboard focus leaving editor commits pending text", async () => {
  const changed = vi.fn();
  const { wrapper } = await renderOverlay("original", {}, { onBubblesMutated: changed });
  wrapper.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  const input = document.querySelector<HTMLTextAreaElement>("[data-translation-editor] textarea")!;
  input.value = "edited";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const cancel = document.querySelector<HTMLButtonElement>('[aria-label="ยกเลิกการแก้ไข"]')!;
  cancel.focus();
  await Promise.resolve();
  expect(changed).not.toHaveBeenCalled();
  const outside = document.createElement("button");
  document.body.appendChild(outside);
  outside.focus();
  await Promise.resolve();
  expect(changed).toHaveBeenCalled();
  expect(document.querySelector("[data-translation-editor]")).toBeNull();
  expect(document.activeElement).toBe(outside);
  expect(undoManager.undo()).toBe("แก้ไขข้อความ");
  expect(undoManager.undo()).toBeNull();
  expect(undoManager.redo()).toBe("แก้ไขข้อความ");
});

test("regression: saved empty text remains editable after reopening overlay", async () => {
  const { wrapper, bubble, container } = await renderOverlay("original");
  wrapper.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  const input = document.querySelector<HTMLTextAreaElement>("[data-translation-editor] textarea")!;
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>('[aria-label="บันทึกข้อความ"]')!.click();
  expect(bubble.deleted).not.toBe(true);
  const restoredBubble = JSON.parse(JSON.stringify(bubble)) as TranslatedBubble;
  await applyTranslationOverlay([restoredBubble], "single", 0, () => {}, undefined, undefined, container, undefined, undefined, "en");
  await vi.runAllTimersAsync();
  const restoredWrapper = container.querySelector<HTMLElement>(".translation-bubble-wrapper")!;
  expect(restoredWrapper).not.toBeNull();
  restoredWrapper.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  const restoredInput = document.querySelector<HTMLTextAreaElement>("[data-translation-editor] textarea")!;
  expect(restoredInput.value).toBe("");
  restoredInput.value = "restored text";
  restoredInput.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>('[aria-label="บันทึกข้อความ"]')!.click();
  expect(restoredBubble.t).toBe("restored text");
});

test("a stale overlay paint bails once a newer generation painted", async () => {
  const explicitContainer = document.createElement("div");
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1000 },
    naturalHeight: { configurable: true, value: 1200 },
  });
  explicitContainer.appendChild(image);
  document.body.appendChild(explicitContainer);

  const styleRef = {
    current: { fontFamily: "Itim, sans-serif", textColor: "#000000", textOutline: "#ffffff", fontSizeMultiplier: 1 },
  };

  let fontCalls = 0;
  let releaseFonts: (() => void) | undefined;
  const fontsGate = new Promise<void>((resolve) => {
    releaseFonts = resolve;
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      load: vi.fn(() => (fontCalls++ === 0 ? fontsGate.then(() => []) : Promise.resolve([]))),
    },
  });

  // Page A starts painting, then page B takes over the same container before
  // A's deferred paint runs — A must bail instead of repainting over B.
  const paintA = applyTranslationOverlay(
    [{ box: [100, 100, 300, 400], t: "จากหน้าเก่า" }],
    "single", 0, vi.fn(), undefined, styleRef, explicitContainer, undefined, undefined, "th",
  );
  const paintB = applyTranslationOverlay(
    [{ box: [100, 100, 300, 400], t: "จากหน้าใหม่" }],
    "single", 0, vi.fn(), undefined, styleRef, explicitContainer, undefined, undefined, "th",
  );

  releaseFonts!();
  await Promise.all([paintA, paintB]);
  await vi.runAllTimersAsync();

  const painted = fillTextSpy.mock.calls.map((c) => String(c[0])).join("|");
  expect(painted).toContain("จากหน้าใหม่");
  expect(painted).not.toContain("จากหน้าเก่า");
});

function mockFontAwareMeasureCtx(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {
        measureText: function (this: { font?: string }, str: string) {
          fontAwareMeasureTextCount += 1;
          const match = /(\d+(?:\.\d+)?)px/.exec(this.font ?? "");
          const fs = match ? parseFloat(match[1]) : 16;
          return { width: str.length * fs * 0.62 };
        },
        fillText: fillTextSpy,
        strokeText: strokeTextSpy,
        clearRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      },
      {
        get(target, property) {
          if (property in target) {
            return target[property as keyof typeof target];
          }
          return vi.fn();
        },
        set(target, property, value) {
          return Reflect.set(target as Record<PropertyKey, unknown>, property, value);
        },
      },
    ) as unknown as CanvasRenderingContext2D,
  );
}

const SMALL_MANUAL_BOX = {
  layoutAdjustment: { bx: 300, by: 300, bw: 90, bh: 70, iw: 1000, ih: 1200 },
};

async function renderOverlayFresh(text: string, overrides: Partial<TranslatedBubble> = {}) {
  vi.resetModules();
  mockFontAwareMeasureCtx();
  const container = document.createElement("div");
  const chromeRoot = document.createElement("div");
  chromeRoot.setAttribute("data-overlay-chrome-layer", "true");
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1000 },
    naturalHeight: { configurable: true, value: 1200 },
  });
  container.appendChild(image);
  document.body.appendChild(container);
  document.body.appendChild(chromeRoot);

  // Fresh module import so the fit engine's shared measuring context is
  // created under the font-aware mock above (the singleton otherwise
  // persists across tests with the fixed-width mock).
  const { applyTranslationOverlay } = await import("@/lib/translationOverlay");
  const bubble: TranslatedBubble = {
    box: [100, 100, 300, 400],
    t: text,
    ...SMALL_MANUAL_BOX,
    ...overrides,
  };
  await applyTranslationOverlay(
    [bubble],
    "single",
    0,
    vi.fn(),
    undefined,
    {
      current: {
        fontFamily: "Itim, sans-serif",
        textColor: "#000000",
        textOutline: "#ffffff",
        fontSizeMultiplier: 1,
      },
    },
    container, undefined, undefined, (/[A-Za-z]/.test(text) && !/\p{Script=Thai}/u.test(text) ? "en" : "th"),
  );
  await vi.runAllTimersAsync();
  const wrapper = container.querySelector<HTMLElement>(".translation-bubble-wrapper")!;
  const canvas = wrapper.querySelector<HTMLCanvasElement>("canvas")!;
  return { wrapper, canvas, container, chromeRoot, bubble };
}

test("grows a manually adjusted frame's height downward until its text fits inside, preserving user width", async () => {
  const { canvas, wrapper } = await renderOverlayFresh(
    "ชื่อนี้ต้องเป็นชื่อที่ถูกใจที่สุดของฉันจริงๆ",
  );
  // Under content-driven reflow (ADR 0018), user-adjusted width is authoritative
  // and stays locked, while height expands downward to fit the lines.
  const grownW = (Number.parseFloat(wrapper.style.width) / 100) * 1000;
  expect(grownW).toBeCloseTo(90, 0);
  expect(Number(canvas.width)).toBeCloseTo(90, 0);

  const grownH = (Number.parseFloat(wrapper.style.height) / 100) * 1200;
  expect(grownH).toBeGreaterThan(70 * 1.3);
  expect(grownH).toBeLessThanOrEqual(70 * 2.5 + 1);
  expect(Number(canvas.height)).toBeCloseTo(grownH, 0);
  expect(fillTextSpy).toHaveBeenCalled();
});

test("keeps a manually adjusted frame untouched when the text already fits", async () => {
  const { canvas } = await renderOverlayFresh("สวัสดี");
  expect(Number(canvas.width)).toBe(90);
});

function firePointer(handle: HTMLElement, type: string, x: number, y: number, flushFrame = true): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  handle.dispatchEvent(event);
  if (type === "pointermove" && flushFrame) vi.advanceTimersByTime(16);
}

// The resize handles convert client deltas to source pixels via the
// inner .tl-canvas rect, so that is the rect the tests must pin.
function mockCanvasRect(container: HTMLElement, zoom = 1): void {
  const tlCanvas = container.querySelector<HTMLElement>(".tl-canvas")!;
  const width = 1000 * zoom;
  const height = 1200 * zoom;
  vi.spyOn(tlCanvas, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: width, bottom: height, width, height,
  } as DOMRect);
}

test("tight selection encloses drawn text without changing layout or intercepting empty space", async () => {
  const layout = { bx: 100, by: 100, bw: 200, bh: 180, iw: 1000, ih: 1200, manualMinHeightPx: 180 };
  const { wrapper, bubble } = await renderOverlay("A", { targetFontSize: 24, layoutAdjustment: { ...layout } });
  const calls = fillTextSpy.mock.calls.map(call => [...call]);
  const selection = wrapper.querySelector<HTMLElement>(".bubble-text-selection")!;
  expect(selection).not.toBeNull();
  expect(parseFloat(selection.style.width)).toBeLessThan(100);
  expect(parseFloat(selection.style.height)).toBeLessThan(100);
  expect(wrapper.style.pointerEvents).toBe("none");
  expect(selection.style.pointerEvents).toBe("auto");
  selection.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 200 }));
  selection.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 200, clientY: 200 }));
  expect(wrapper.dataset.selected).toBe("true");
  expect(fillTextSpy.mock.calls).toEqual(calls);
  expect(bubble.layoutAdjustment).toEqual(layout);
});

test("a completed selection click does not persist a legacy layout", async () => {
  const changed = vi.fn();
  const { wrapper, bubble, container } = await renderOverlay("A", {}, { onBubblesMutated: changed });
  mockCanvasRect(container);
  const selection = wrapper.querySelector<HTMLElement>(".bubble-text-selection")!;
  const before = JSON.stringify(bubble);
  const saved = localStorage.length;
  firePointer(selection, "pointerdown", 200, 200);
  firePointer(selection, "pointerup", 200, 200);
  expect(JSON.stringify(bubble)).toBe(before);
  expect(localStorage.length).toBe(saved);
  expect(changed).not.toHaveBeenCalled();
});

test("rotated corner scaling near the bottom remains stable after redo and reopening", async () => {
  const { container, wrapper, chromeRoot, bubble } = await renderOverlay("A", { targetFontSize: 24,
    layoutAdjustment: { bx: 100, by: 1010, bw: 200, bh: 180, iw: 1000, ih: 1200, rotation: 180, manualMinHeightPx: 180 } });
  mockCanvasRect(container);
  const anchor = selectionSouthWest(wrapper, 180);
  const handle = chromeRoot.querySelector<HTMLElement>('.action-handle--scale')!;
  handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn(); handle.hasPointerCapture = () => true;
  firePointer(handle, "pointerdown", 200, 200);
  firePointer(handle, "pointermove", 140, 254);
  firePointer(handle, "pointerup", 140, 254);
  const saved = JSON.parse(JSON.stringify(bubble));
  expect(saved.layoutAdjustment.by + saved.layoutAdjustment.bh).toBeLessThanOrEqual(1200);
  expect(selectionSouthWest(wrapper, 180).x).toBeCloseTo(anchor.x, 5);
  expect(selectionSouthWest(wrapper, 180).y).toBeCloseTo(anchor.y, 5);
  undoManager.undo(); undoManager.redo();
  expect(bubble.layoutAdjustment).toEqual(saved.layoutAdjustment);
  const reopened = await renderOverlay("A", saved);
  expect(reopened.wrapper.style.height).toBe(wrapper.style.height);
});

function selectionSouthWest(wrapper: HTMLElement, rotation = 0) {
  const frame = wrapper.querySelector<HTMLElement>(".bubble-text-selection")!;
  const width = parseFloat(wrapper.style.width) * 10, height = parseFloat(wrapper.style.height) * 12;
  const x = parseFloat(frame.style.left) / 100 * width;
  const y = (parseFloat(frame.style.top) + parseFloat(frame.style.height)) / 100 * height;
  const angle = rotation * Math.PI / 180;
  return { x: parseFloat(wrapper.style.left) * 10 + width / 2 + (x-width/2)*Math.cos(angle)-(y-height/2)*Math.sin(angle),
    y: parseFloat(wrapper.style.top) * 12 + height / 2 + (x-width/2)*Math.sin(angle)+(y-height/2)*Math.cos(angle) };
}

test.each([0, 30])("tight selection corner scale fixes the opposite visible corner at %s degrees", async rotation => {
  const { container, wrapper, chromeRoot } = await renderOverlay("A", { targetFontSize: 24,
    layoutAdjustment: { bx: 100, by: 100, bw: 200, bh: 180, iw: 1000, ih: 1200, rotation, manualMinHeightPx: 180 } });
  mockCanvasRect(container);
  const initial = selectionSouthWest(wrapper, rotation);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn(); handle.hasPointerCapture = () => true;
  firePointer(handle, "pointerdown", 200, 200);
  firePointer(handle, "pointermove", 240, 170);
  firePointer(handle, "pointerup", 240, 170);
  const final = selectionSouthWest(wrapper, rotation);
  expect(final.x).toBeCloseTo(initial.x, 5); expect(final.y).toBeCloseTo(initial.y, 5);
  undoManager.undo();
  expect(selectionSouthWest(wrapper, rotation)).toEqual(initial);
});

test.each(["pointerup", "pointercancel"])("tight selection returns after width drag %s including no movement", async ending => {
  const { container, wrapper, chromeRoot } = await renderOverlay("A", { targetFontSize: 24,
    layoutAdjustment: { bx: 100, by: 100, bw: 200, bh: 180, iw: 1000, ih: 1200, manualMinHeightPx: 180 } });
  mockCanvasRect(container);
  const selection = wrapper.querySelector<HTMLElement>(".bubble-text-selection")!;
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn(); handle.hasPointerCapture = () => true;
  firePointer(handle, "pointerdown", 200, 200);
  expect(selection.style.width).toBe("100%");
  firePointer(handle, ending, 200, 200);
  expect(parseFloat(selection.style.width)).toBeLessThan(100);
});

test("scales the text with the corner resize handle", async () => {
  const { container, chromeRoot, bubble } = await renderOverlay("ปรับขนาด", {
    layoutAdjustment: { bx: 100, by: 100, bw: 200, bh: 360, iw: 1000, ih: 1200 },
    fontSizeMultiplier: 1,
  });
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  firePointer(handle, "pointerdown", 500, 500);
  // Move along the corner diagonal: both dimensions grow by 1.25.
  firePointer(handle, "pointermove", 550, 410);
  firePointer(handle, "pointerup", 550, 410);
  expect(bubble.fontSizeMultiplier).toBeCloseTo(1.25, 5);
});

test.each([{dx:80,dy:0},{dx:0,dy:-90},{dx:50,dy:-90},{dx:-50,dy:90},{dx:50,dy:-90,targetFontSize:40}])('corner scaling preserves frame proportions at 44% zoom: %j', async ({dx,dy,...settings}) => {
  const {container,chromeRoot,bubble,wrapper}=await renderOverlayFresh('ปรับขนาด',{
    layoutAdjustment:{bx:100,by:100,bw:200,bh:360,iw:1000,ih:1200},fontSizeMultiplier:1,
    ...settings,
  });
  mockCanvasRect(container,.44);
  const handle=chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture=vi.fn();handle.releasePointerCapture=vi.fn();
  (handle as unknown as {hasPointerCapture:()=>boolean}).hasPointerCapture=()=>true;
  const beforeW=parseFloat(wrapper.style.width)*10;
  const beforeH=parseFloat(wrapper.style.height)*12;
  const beforeAnchor=selectionSouthWest(wrapper);
  firePointer(handle,'pointerdown',500,500);
  firePointer(handle,'pointermove',500+dx*.44,500+dy*.44);
  firePointer(handle,'pointerup',500+dx*.44,500+dy*.44);
  const final=bubble.layoutAdjustment!;
  expect(final.bw/beforeW).toBeCloseTo(final.bh/beforeH,5);
  expect(bubble.fontSizeMultiplier).toBeCloseTo(final.bw/beforeW,5);
  const afterAnchor=selectionSouthWest(wrapper);
  expect(afterAnchor.x).toBeCloseTo(beforeAnchor.x,5);
  expect(afterAnchor.y).toBeCloseTo(beforeAnchor.y,5);
  expect(bubble.targetFontSize).toBeGreaterThan(0);
});

test('corner scaling restores geometry and font on cancel and Undo/Redo', async () => {
  const {container,chromeRoot,bubble}=await renderOverlayFresh('ปรับขนาด',{
    layoutAdjustment:{bx:100,by:100,bw:200,bh:360,iw:1000,ih:1200},fontSizeMultiplier:1,
  });
  const {undoManager: freshUndo}=await import('@/lib/undoManager');
  mockCanvasRect(container);
  const handle=chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture=vi.fn();handle.releasePointerCapture=vi.fn();
  (handle as unknown as {hasPointerCapture:()=>boolean}).hasPointerCapture=()=>true;
  firePointer(handle,'pointerdown',500,500);
  firePointer(handle,'pointermove',550,410);
  firePointer(handle,'pointercancel',550,410);
  expect(bubble.targetFontSize).toBeUndefined();
  expect(bubble.fontSizeMultiplier).toBe(1);
  expect(freshUndo.undo()).toBeNull();
  firePointer(handle,'pointerdown',500,500);
  firePointer(handle,'pointermove',550,410);
  firePointer(handle,'pointerup',550,410);
  expect(bubble.layoutAdjustment).toMatchObject({bw:250,bh:450});
  const locked=bubble.targetFontSize;
  const scaledLayout = { ...bubble.layoutAdjustment! };
  freshUndo.undo();
  expect(bubble.layoutAdjustment).toMatchObject({bw:200,bh:360,by:100});
  expect(bubble.targetFontSize).toBeUndefined();
  freshUndo.redo();
  expect(bubble.layoutAdjustment).toEqual(scaledLayout);
  expect(bubble.targetFontSize).toBe(locked);
});

test.each([{width:80,height:40,font:20},{width:200,height:100,font:12}])('corner shrink respects the renderer floors without stretching: %j', async ({width,height,font})=>{
  const {container,chromeRoot,bubble,wrapper,canvas}=await renderOverlayFresh('A',{
    layoutAdjustment:{bx:100,by:100,bw:width,bh:height,iw:1000,ih:1200},targetFontSize:font,fontSizeMultiplier:1,
  });
  mockCanvasRect(container);
  const beforeW=parseFloat(wrapper.style.width)*10,beforeH=parseFloat(wrapper.style.height)*12;
  const handle=chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture=vi.fn();handle.releasePointerCapture=vi.fn();
  (handle as unknown as {hasPointerCapture:()=>boolean}).hasPointerCapture=()=>true;
  firePointer(handle,'pointerdown',500,500);
  firePointer(handle,'pointermove',500-beforeW*.9,500+beforeH*.9);
  firePointer(handle,'pointerup',500-beforeW*.9,500+beforeH*.9);
  const final=bubble.layoutAdjustment!;
  expect(final.bw/beforeW).toBeCloseTo(final.bh/beforeH,5);
  expect(final.bh).toBeGreaterThanOrEqual(25);
  const effective=Math.round(font*bubble.fontSizeMultiplier!);
  expect(effective).toBeGreaterThanOrEqual(8);
  expect(canvas.height).toBe(Math.round(final.bh));
});



test("preserves font size multiplier and reflows with top-anchored height when width handle is dragged", async () => {
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh("ปรับกว้าง", {
    layoutAdjustment: { bx: 100, by: 100, bw: 200, bh: 360, iw: 1000, ih: 1200 },
    fontSizeMultiplier: 1,
  });
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  const initTop = Number.parseFloat(wrapper.style.top);
  firePointer(handle, "pointerdown", 500, 500);
  // Stretching +60 source px on a 200px frame increases width to 260px.
  // Font size multiplier MUST remain preserved (Ticket 02).
  firePointer(handle, "pointermove", 560, 500);
  expect(bubble.fontSizeMultiplier).toBe(1);
  // Top coordinate remains anchored (Ticket 03)
  expect(Number.parseFloat(wrapper.style.top)).toBeCloseTo(initTop, 2);

  firePointer(handle, "pointerup", 560, 500);
  expect(bubble.fontSizeMultiplier).toBe(1);
  expect(bubble.layoutAdjustment?.bw).toBeCloseTo(260, 1);
});

test("widening width handle locks font size and does not expand or balloon the text", async () => {
  const text = "ข้อความสำหรับการทดสอบความกว้างของกรอบข้อความ";
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh(text, {
    layoutAdjustment: { bx: 100, by: 100, bw: 100, bh: 300, iw: 1000, ih: 1200 },
    fontSizeMultiplier: 1,
  });
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  const bCanvas = wrapper.querySelector("canvas")!;
  const ctx = bCanvas.getContext("2d")!;
  const initialFont = (ctx as unknown as { font: string }).font;

  firePointer(handle, "pointerdown", 500, 500);
  // Widen from 100px to 300px (+200px)
  firePointer(handle, "pointermove", 700, 500);
  firePointer(handle, "pointerup", 700, 500);

  const widenedFont = (ctx as unknown as { font: string }).font;
  expect(widenedFont).toBe(initialFont);
  expect(bubble.targetFontSize).toBeDefined();
  expect(bubble.layoutAdjustment?.targetFontSize).toBe(bubble.targetFontSize);
});

test("keeps a new bubble's visible font fixed through wide-narrow-wide drag at 44% zoom", async () => {
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh(
    "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ",
    { layoutAdjustment: undefined, fontSizeMultiplier: 3 },
  );
  mockCanvasRect(container, 0.44);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  const context = wrapper.querySelector("canvas")!.getContext("2d")!;
  const initialFont = context.font;
  const initialWidth = Number(wrapper.querySelector("canvas")!.width);
  const initialLeft = wrapper.style.left;
  const initialTop = wrapper.style.top;
  let fillCallStart = fillTextSpy.mock.calls.length;
  firePointer(handle, "pointerdown", 220, 260);

  firePointer(handle, "pointermove", 264, 260);
  const wideFont = context.font;
  const wideHeight = Number(wrapper.querySelector("canvas")!.height);
  const wideLines = fillTextSpy.mock.calls.slice(fillCallStart).map((call) => String(call[0]));
  fillCallStart = fillTextSpy.mock.calls.length;
  firePointer(handle, "pointermove", 132, 260);
  const narrowFont = context.font;
  const narrowHeight = Number(wrapper.querySelector("canvas")!.height);
  const narrowWidth = Number(wrapper.querySelector("canvas")!.width);
  const narrowLines = fillTextSpy.mock.calls.slice(fillCallStart).map((call) => String(call[0]));
  fillCallStart = fillTextSpy.mock.calls.length;
  firePointer(handle, "pointermove", 264, 260);
  const restoredWideFont = context.font;
  const restoredWideLines = fillTextSpy.mock.calls.slice(fillCallStart).map((call) => String(call[0]));

  expect(wideFont).toBe(initialFont);
  expect(narrowFont).toBe(initialFont);
  expect(restoredWideFont).toBe(initialFont);
  expect(narrowWidth).toBeLessThan(initialWidth);
  expect(narrowHeight).toBeGreaterThan(wideHeight);
  expect(narrowLines.length).toBeGreaterThan(wideLines.length);
  expect(restoredWideLines).toEqual(wideLines);
  expect(wrapper.style.left).toBe(initialLeft);
  expect(wrapper.style.top).toBe(initialTop);

  firePointer(handle, "pointerup", 264, 260);
  expect(context.font).toBe(initialFont);
  expect(bubble.layoutAdjustment?.bw).toBeCloseTo(initialWidth + 100, 0);
});

test("clicking a legacy width handle without dragging leaves its saved layout unchanged", async () => {
  const { container, chromeRoot, bubble } = await renderOverlayFresh("สวัสดี", {
    layoutAdjustment: { bx: 100, by: 100, bw: 240, bh: 120, iw: 1000, ih: 1200 },
  });
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const originalAdjustment = JSON.stringify(bubble.layoutAdjustment);
  const originalStorage = window.localStorage.getItem("superk:overlay-adjustments");

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 500, 500);
  firePointer(handle, "pointerup", 500, 500);

  expect(bubble.targetFontSize).toBeUndefined();
  expect(JSON.stringify(bubble.layoutAdjustment)).toBe(originalAdjustment);
  expect(window.localStorage.getItem("superk:overlay-adjustments")).toBe(originalStorage);
  expect(undoManager.undo()).toBeNull();
});

test("a real width drag establishes fixed-font mode even when it returns to its starting width", async () => {
  const { container, chromeRoot, bubble, canvas } = await renderOverlayFresh("ข้อความทดสอบ", {
    layoutAdjustment: { bx: 100, by: 100, bw: 240, bh: 120, iw: 1000, ih: 1200 },
  });
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const initialWidth = canvas.width;

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 600, 500);
  firePointer(handle, "pointermove", 500, 500);
  firePointer(handle, "pointerup", 500, 500);

  expect(canvas.width).toBe(initialWidth);
  expect(bubble.targetFontSize).toBeDefined();
  expect(bubble.layoutAdjustment?.targetFontSize).toBe(bubble.targetFontSize);
  const { undoManager: activeUndoManager } = await import("@/lib/undoManager");
  expect(activeUndoManager.undo()).toBe("ปรับความกว้างกล่องข้อความ");
  expect(bubble.targetFontSize).toBeUndefined();
});

test("moving a bubble does not remeasure or repaint its text on every pointer event", async () => {
  const {wrapper,canvas,container}=await renderOverlayFresh("ข้อความสำหรับลากย้าย", {targetFontSize:24});
  mockCanvasRect(container);
  wrapper.setPointerCapture=vi.fn(); wrapper.releasePointerCapture=vi.fn();
  const beforeWidth=canvas.width, beforeHeight=canvas.height;
  fillTextSpy.mockClear();
  firePointer(wrapper,"pointerdown",500,500);
  for(let i=1;i<=40;i++) firePointer(wrapper,"pointermove",500+i,500+i,false);
  vi.advanceTimersByTime(16);
  expect(fillTextSpy).not.toHaveBeenCalled();
  expect(canvas.width).toBe(beforeWidth); expect(canvas.height).toBe(beforeHeight);
  firePointer(wrapper,"pointerup",540,540);
});

test("wrapper drag commits release coordinates and cancel restores its original placement", async () => {
  const {wrapper,container,bubble}=await renderOverlayFresh("ลากแล้วปล่อย",{targetFontSize:24});
  mockCanvasRect(container);
  wrapper.setPointerCapture=vi.fn(); wrapper.releasePointerCapture=vi.fn();
  const initialLeft=Number.parseFloat(wrapper.style.left), initialTop=Number.parseFloat(wrapper.style.top);
  firePointer(wrapper,"pointerdown",500,500);
  firePointer(wrapper,"pointermove",520,520,false);
  firePointer(wrapper,"pointerup",550,550);
  expect(Number.parseFloat(wrapper.style.left)).toBeCloseTo(initialLeft+5);
  expect(Number.parseFloat(wrapper.style.top)).toBeCloseTo(initialTop+50/1200*100);
  const committed=bubble.layoutAdjustment;
  firePointer(wrapper,"pointerdown",550,550);
  firePointer(wrapper,"pointermove",650,650);
  firePointer(wrapper,"pointercancel",650,650);
  vi.advanceTimersByTime(32);
  expect(bubble.layoutAdjustment?.bx).toBe(committed?.bx);
  expect(bubble.layoutAdjustment?.by).toBe(committed?.by);
  const {undoManager:dragUndo}=await import("@/lib/undoManager");
  dragUndo.undo();
  expect(Number.parseFloat(wrapper.style.left)).toBeCloseTo(initialLeft);
  expect(Number.parseFloat(wrapper.style.top)).toBeCloseTo(initialTop);
});

test("move handle persists the settled frame height at the page edge", async () => {
  const {wrapper,chromeRoot,container,bubble,canvas}=await renderOverlayFresh("ข้อความยาวสำหรับทดสอบขอบล่าง",{targetFontSize:24});
  mockCanvasRect(container);
  const handle=chromeRoot.querySelector<HTMLElement>('[data-handle-position="sw"]')!;
  handle.setPointerCapture=vi.fn(); (handle as unknown as {hasPointerCapture:()=>boolean}).hasPointerCapture=()=>true;
  handle.releasePointerCapture=vi.fn();
  firePointer(handle,"pointerdown",500,500);
  firePointer(handle,"pointermove",500,1480);
  firePointer(handle,"pointerup",500,1480);
  expect(Math.round(bubble.layoutAdjustment!.bh)).toBe(canvas.height);
  expect(bubble.layoutAdjustment!.bh/1200*100).toBeCloseTo(Number.parseFloat(wrapper.style.height));
});

test("clicking the rotate handle without moving does not snap the existing rotation", async () => {
  const {chromeRoot,bubble}=await renderOverlayFresh("คลิกอย่างเดียว",{rotation:3,layoutAdjustment:{bx:300,by:300,bw:200,bh:200,iw:1000,ih:1200,rotation:3}});
  const handle=chromeRoot.querySelector<HTMLElement>('[data-handle-position="nw"]')!;
  handle.setPointerCapture=vi.fn(); (handle as unknown as {hasPointerCapture:()=>boolean}).hasPointerCapture=()=>true;
  handle.releasePointerCapture=vi.fn();
  firePointer(handle,"pointerdown",500,500);
  firePointer(handle,"pointerup",500,500);
  expect(bubble.layoutAdjustment?.rotation).toBe(3);
});

test("corner resizing coalesces pointer bursts and commits the final release position", async () => {
  const {chromeRoot,container,wrapper}=await renderOverlayFresh("ข้อความสำหรับขยาย",{targetFontSize:24});
  mockCanvasRect(container);
  const handle=chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture=vi.fn(); (handle as unknown as {hasPointerCapture:()=>boolean}).hasPointerCapture=()=>true;
  handle.releasePointerCapture=vi.fn();
  const widthBefore=Number.parseFloat(wrapper.style.width);
  firePointer(handle,"pointerdown",500,500);
  fillTextSpy.mockClear();
  for(let i=1;i<=40;i++) firePointer(handle,"pointermove",500+i,500-i,false);
  expect(fillTextSpy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(16);
  // The coalesced frame previews with the captured bitmap via proportional
  // CSS sizing — the frame grows without retypesetting any glyph.
  expect(fillTextSpy).not.toHaveBeenCalled();
  expect(Number.parseFloat(wrapper.style.width)).toBeGreaterThan(widthBefore);
  firePointer(handle,"pointermove",560,440,false);
  expect(fillTextSpy).not.toHaveBeenCalled();
  firePointer(handle,"pointerup",570,430);
  expect(fillTextSpy).toHaveBeenCalled();
  expect(Number.parseFloat(wrapper.style.width)).toBeGreaterThan(widthBefore);
  const committedWidth=wrapper.style.width;
  vi.advanceTimersByTime(32);
  expect(wrapper.style.width).toBe(committedWidth);
});

test("canceling a corner preview discards its queued pointer and restores the frame", async () => {
  const {chromeRoot,container,wrapper}=await renderOverlayFresh("ขยายแล้วกดยกเลิก",{targetFontSize:24});
  mockCanvasRect(container);
  const handle=chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture=vi.fn(); (handle as unknown as {hasPointerCapture:()=>boolean}).hasPointerCapture=()=>true;
  handle.releasePointerCapture=vi.fn();
  const before={width:wrapper.style.width,height:wrapper.style.height,top:wrapper.style.top};
  firePointer(handle,"pointerdown",500,500);
  firePointer(handle,"pointermove",600,400,false);
  firePointer(handle,"pointercancel",600,400);
  const afterCancel=fillTextSpy.mock.calls.length;
  vi.advanceTimersByTime(32);
  expect(fillTextSpy.mock.calls.length).toBe(afterCancel);
  expect({width:wrapper.style.width,height:wrapper.style.height,top:wrapper.style.top}).toEqual(before);
});

test("overlay cleanup cancels a pending corner redraw", async () => {
  const {chromeRoot,container}=await renderOverlayFresh("เปลี่ยนหน้าระหว่างขยาย",{targetFontSize:24});
  mockCanvasRect(container);
  const handle=chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture=vi.fn(); (handle as unknown as {hasPointerCapture:()=>boolean}).hasPointerCapture=()=>true;
  firePointer(handle,"pointerdown",500,500);
  firePointer(handle,"pointermove",600,400,false);
  fillTextSpy.mockClear();
  const overlay=container.querySelector(".tl-overlay,.tl-canvas") as HTMLElement & {_cleanupListeners:()=>void};
  overlay._cleanupListeners();
  vi.advanceTimersByTime(32);
  expect(fillTextSpy).not.toHaveBeenCalled();
});

test("coalesces rapid width pointer moves into the latest animation frame", async () => {
  const { container, chromeRoot, wrapper } = await renderOverlayFresh(
    "ข้อความสำหรับตรวจการเคลื่อนไหว",
    { layoutAdjustment: { bx: 100, by: 100, bw: 240, bh: 120, iw: 1000, ih: 1200 } },
  );
  mockCanvasRect(container, 0.44);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const canvas = wrapper.querySelector("canvas")!;
  const initialWidth = canvas.width;
  const callsBefore = fillTextSpy.mock.calls.length;

  firePointer(handle, "pointerdown", 220, 260);
  firePointer(handle, "pointermove", 264, 260, false);
  firePointer(handle, "pointermove", 308, 260, false);
  expect(fillTextSpy.mock.calls.length).toBe(callsBefore);

  await vi.advanceTimersByTimeAsync(16);
  expect(canvas.width).toBe(initialWidth + 200);
  expect(fillTextSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  firePointer(handle, "pointerup", 308, 260);
});

test("holds the dragged frame during a resize and never rockets the floor", async () => {
  const { container, chromeRoot, wrapper } = await renderOverlayFresh(
    "ชื่อนี้ต้องเป็นชื่อที่ถูกใจที่สุดของฉันจริงๆ",
    {
      fontSizeMultiplier: 3,
      layoutAdjustment: { bx: 300, by: 300, bw: 400, bh: 200, iw: 1000, ih: 1200 },
    },
  );
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  const before = Number.parseFloat(wrapper.style.width);
  firePointer(handle, "pointerdown", 500, 500);
  // Each move re-renders; the frame floor must stay paused so the frame
  // tracks the cursor instead of fighting it (and never compounds).
  firePointer(handle, "pointermove", 470, 500);
  const midDrag1 = Number.parseFloat(wrapper.style.width);
  expect(midDrag1).toBeCloseTo(before - 3, 1);
  firePointer(handle, "pointermove", 440, 500);
  const midDrag2 = Number.parseFloat(wrapper.style.width);
  expect(midDrag2).toBeCloseTo(before - 6, 1);
  firePointer(handle, "pointerup", 440, 500);
  await vi.runAllTimersAsync();
  const after = Number.parseFloat(wrapper.style.width);
  // On release the floor may re-fit once, but it stays bounded by 2.5x of
  // the dragged size — never the compounding balloon.
  expect(after).toBeGreaterThanOrEqual(midDrag2 - 0.5);
  expect(after).toBeLessThanOrEqual(midDrag2 * 2.5 + 1);
});

test("repairs inflated legacy adjustments left by the old floor bug", async () => {
  const { canvas, wrapper } = await renderOverlay("บั๊กกรอบบวม", {
    layoutAdjustment: { bx: -500, by: 100, bw: 4000, bh: 900, iw: 1000, ih: 1200 },
  });
  // The detection box is 300x240 source px (box is [ymin,xmin,ymax,xmax]);
  // a saved 4000px-wide frame is rocket damage and must clamp back to 4x
  // per dimension, re-centered inside the page.
  const wPct = Number.parseFloat(wrapper.style.width);
  expect(wPct).toBeLessThanOrEqual(120.1);
  expect(Number(canvas.width)).toBeLessThanOrEqual(1201);
  expect(Number.parseFloat(wrapper.style.left)).toBeGreaterThanOrEqual(0);
});

test("narrowing width handle reflows text, expands height downward top-anchored, and supports undo", async () => {
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh(
    "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ",
    {
      layoutAdjustment: { bx: 100, by: 100, bw: 240, bh: 120, iw: 1000, ih: 1200 },
      fontSizeMultiplier: 1,
    },
  );
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  const initTop = Number.parseFloat(wrapper.style.top);
  const initHeight = Number.parseFloat(wrapper.style.height);

  firePointer(handle, "pointerdown", 500, 500);
  // Drag narrower by -160 source px (from 240px down to 80px)
  firePointer(handle, "pointermove", 340, 500);

  // Top coordinate must remain strictly anchored (no jump)
  expect(Number.parseFloat(wrapper.style.top)).toBeCloseTo(initTop, 2);
  // Height must expand downward to fit the reflowed lines
  const newHeight = Number.parseFloat(wrapper.style.height);
  expect(newHeight).toBeGreaterThan(initHeight);
  // Font size multiplier remains locked
  expect(bubble.fontSizeMultiplier).toBe(1);

  firePointer(handle, "pointerup", 340, 500);
  expect(bubble.layoutAdjustment?.bw).toBeGreaterThan(80);
  expect(bubble.layoutAdjustment?.bw).toBeLessThan(240);
  expect(bubble.layoutAdjustment?.bh).toBeGreaterThan(120);

  const { undoManager: freshUndoManager } = await import("@/lib/undoManager");
  // Undo reverts both width and height
  freshUndoManager.undo();
  expect(bubble.layoutAdjustment?.bw).toBeCloseTo(240, 1);
  expect(bubble.layoutAdjustment?.bh).toBeCloseTo(120, 1);
});

test("pointercancel restores the complete width-drag snapshot without saving", async () => {
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh(
    "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ",
    {
      layoutAdjustment: { bx: 100, by: 100, bw: 240, bh: 120, iw: 1000, ih: 1200 },
      fontSizeMultiplier: 1,
    },
  );
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const originalStyle = {
    left: wrapper.style.left,
    top: wrapper.style.top,
    width: wrapper.style.width,
    height: wrapper.style.height,
  };
  const originalAdjustment = JSON.stringify(bubble.layoutAdjustment);
  const originalStorage = window.localStorage.getItem("superk:overlay-adjustments");

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 340, 500);
  expect(wrapper.style.height).not.toBe(originalStyle.height);
  firePointer(handle, "pointercancel", 340, 500);

  expect({
    left: wrapper.style.left,
    top: wrapper.style.top,
    width: wrapper.style.width,
    height: wrapper.style.height,
  }).toEqual(originalStyle);
  expect(bubble.targetFontSize).toBeUndefined();
  expect(JSON.stringify(bubble.layoutAdjustment)).toBe(originalAdjustment);
  expect(window.localStorage.getItem("superk:overlay-adjustments")).toBe(originalStorage);
  expect(undoManager.undo()).toBeNull();
});

test("pointercancel restores the original top of an out-of-page frame", async () => {
  const { container, chromeRoot, wrapper } = await renderOverlayFresh("ข้อความทดสอบ", {
    layoutAdjustment: { bx: 100, by: 1150, bw: 240, bh: 120, iw: 1000, ih: 1200 },
  });
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const initialTop = wrapper.style.top;

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 340, 500);
  expect(Number.parseFloat(wrapper.style.top) * 12).toBeCloseTo(1080, 1);
  firePointer(handle, "pointercancel", 340, 500);

  expect(wrapper.style.top).toBe(initialTop);
});

test("width reflow shrinks back only to its saved manual minimum height", async () => {
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh(
    "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ",
    {
      layoutAdjustment: {
        bx: 100, by: 300, bw: 240, bh: 130, iw: 1000, ih: 1200,
        manualMinHeightPx: 100,
      },
      fontSizeMultiplier: 1,
    },
  );
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 600, 500);
  expect(Number(wrapper.querySelector("canvas")!.height)).toBe(100);
  firePointer(handle, "pointermove", 340, 500);
  expect(Number(wrapper.querySelector("canvas")!.height)).toBeGreaterThan(100);
  firePointer(handle, "pointermove", 600, 500);
  expect(Number(wrapper.querySelector("canvas")!.height)).toBe(100);
  firePointer(handle, "pointerup", 600, 500);

  expect(bubble.layoutAdjustment?.manualMinHeightPx).toBe(100);
});

test("first width drag uses saved height instead of legacy automatic growth as its minimum", async () => {
  const { container, chromeRoot, wrapper, bubble } = await renderOverlayFresh(
    "ชื่อนี้ต้องเป็นชื่อที่ถูกใจที่สุดของฉันจริงๆ",
    { layoutAdjustment: { bx: 300, by: 300, bw: 90, bh: 70, iw: 1000, ih: 1200 } },
  );
  mockCanvasRect(container);
  const grownLegacyHeight = Number(wrapper.querySelector("canvas")!.height);
  expect(grownLegacyHeight).toBeGreaterThan(70);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 700, 500);

  expect(Number(wrapper.querySelector("canvas")!.height)).toBeGreaterThanOrEqual(70);
  expect(Number(wrapper.querySelector("canvas")!.height)).toBeLessThan(grownLegacyHeight);
  firePointer(handle, "pointerup", 700, 500);
  expect(bubble.layoutAdjustment?.manualMinHeightPx).toBe(70);
});

test("restores tall fixed-font layouts without legacy recentering", async () => {
  const { wrapper, canvas } = await renderOverlayFresh("สวัสดี", {
    targetFontSize: 16,
    layoutAdjustment: {
      bx: 100, by: 100, bw: 100, bh: 2000, iw: 1000, ih: 1200,
      targetFontSize: 16, manualMinHeightPx: 1000,
    },
  });

  expect(Number.parseFloat(wrapper.style.top) * 12).toBeCloseTo(100, 1);
  expect(canvas.height).toBe(1000);
});

test("reports text overflow when fixed-font reflow reaches the bottom of the page", async () => {
  const { container, chromeRoot, wrapper } = await renderOverlayFresh(
    "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ",
    {
      layoutAdjustment: { bx: 100, by: 1150, bw: 240, bh: 25, iw: 1000, ih: 1200 },
      fontSizeMultiplier: 1,
    },
  );
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 340, 500);

  expect(wrapper.dataset.layoutOverflow).toBe("true");
  expect(wrapper.querySelector<HTMLElement>(".bubble-layout-overflow")?.hidden).toBe(false);
  expect(wrapper.title).toContain("ข้อความล้นพื้นที่หน้า");
});

test("width drag stops at the whole-word floor and shifts left only to keep it on the page", async () => {
  const { container, chromeRoot, wrapper } = await renderOverlayFresh(
    "supercalifragilistic",
    {
      isInvalidBox: true,
      targetFontSize: 10,
      layoutAdjustment: { bx: 900, by: 200, bw: 200, bh: 100, iw: 1000, ih: 1200 },
    },
  );
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const initialTop = Number.parseFloat(wrapper.style.top);

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 100, 500);

  const left = Number.parseFloat(wrapper.style.left) * 10;
  const width = Number.parseFloat(wrapper.style.width) * 10;
  expect(width).toBeGreaterThan(100);
  expect(left).toBeLessThan(900);
  expect(left + width).toBeCloseTo(1000, 0);
  expect(Number.parseFloat(wrapper.style.top)).toBeCloseTo(initialTop, 2);
  expect(wrapper.dataset.layoutOverflow).toBe("false");
});

test("does not expand or relocate a bubble when a whole word is wider than the page", async () => {
  const text = "W".repeat(300);
  const { container, chromeRoot, wrapper } = await renderOverlayFresh(text, {
    isInvalidBox: true,
    targetFontSize: 10,
    layoutAdjustment: { bx: 200, by: 200, bw: 2500, bh: 100, iw: 1000, ih: 1200 },
  });
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const initialLeft = Number.parseFloat(wrapper.style.left);
  const initialWidth = Number.parseFloat(wrapper.style.width);

  firePointer(handle, "pointerdown", 500, 500);
  firePointer(handle, "pointermove", 100, 500);

  expect(Number.parseFloat(wrapper.style.left)).toBeCloseTo(initialLeft, 2);
  expect(Number.parseFloat(wrapper.style.width)).toBeCloseTo(initialWidth, 2);
  expect(wrapper.dataset.layoutOverflow).toBe("true");
  expect(fillTextSpy.mock.calls.map((call) => String(call[0]))).toContain(text);
});

test("keeps an undersized saved frame, reports word overflow, and exports the intact text", async () => {
  const text = "supercalifragilistic";
  const { container, wrapper, canvas, chromeRoot, bubble } = await renderOverlayFresh(text, {
    isInvalidBox: true,
    targetFontSize: 10,
    layoutAdjustment: { bx: 100, by: 200, bw: 40, bh: 60, iw: 1000, ih: 1200 },
  });

  expect(canvas.width).toBe(40);
  expect(wrapper.dataset.layoutOverflow).toBe("true");
  expect(wrapper.querySelector<HTMLElement>(".bubble-layout-overflow")?.hidden).toBe(false);
  expect(fillTextSpy.mock.calls.map((call) => String(call[0]))).toContain(text);

  const exportDataUrl = downloadTranslatedImage("single", 0, "", true, container);
  expect(exportDataUrl).toBe("data:image/jpeg;base64,dHJhbnNsYXRlZA==");
  expect(canvas.width).toBe(40);

  chromeRoot.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
  const textarea = document.querySelector<HTMLTextAreaElement>("[data-translation-editor] textarea")!;
  const editedText = "an-editedwordthatiswiderthanthesavedframe";
  textarea.value = editedText;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));

  expect(bubble.t).toBe(editedText);
  expect(canvas.width).toBe(40);
  expect(wrapper.dataset.layoutOverflow).toBe("true");
  expect(fillTextSpy.mock.calls.map((call) => String(call[0]))).toContain(editedText);
});

test("editing text via editor textarea expands height downward while keeping user-specified width intact", async () => {
  const { wrapper, chromeRoot } = await renderOverlayFresh("ข้อความสั้น", {
    layoutAdjustment: { bx: 100, by: 100, bw: 150, bh: 80, iw: 1000, ih: 1200 },
  });
  const widthBefore = Number.parseFloat(wrapper.style.width);
  const heightBefore = Number.parseFloat(wrapper.style.height);

  chromeRoot.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
  const textarea = document.querySelector<HTMLTextAreaElement>("[data-translation-editor] textarea")!;
  textarea.value = "นี่คือข้อความที่ยาวขึ้นมากซึ่งต้องการพื้นที่แนวตั้งเพิ่มเติมสำหรับการแสดงผลหลายบรรทัด";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));

  const widthAfter = Number.parseFloat(wrapper.style.width);
  const heightAfter = Number.parseFloat(wrapper.style.height);

  // Width is locked to user adjustment
  expect(widthAfter).toBeCloseTo(widthBefore, 1);
  // Height expands downward to accommodate longer text
  expect(heightAfter).toBeGreaterThan(heightBefore);
});

test("single width handle slides left and right smoothly: widening to right wraps into fewer lines, narrowing to left expands height top-anchored", async () => {
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh(
    "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ",
    {
      layoutAdjustment: { bx: 100, by: 100, bw: 200, bh: 140, iw: 1000, ih: 1200 },
      fontSizeMultiplier: 1,
    },
  );
  mockCanvasRect(container);
  const widthHandle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  expect(widthHandle).toBeTruthy();
  expect(chromeRoot.querySelector('[data-handle-position="w"]')).toBeNull();
  widthHandle.setPointerCapture = vi.fn();
  (widthHandle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  widthHandle.releasePointerCapture = vi.fn();

  const initTop = Number.parseFloat(wrapper.style.top);

  // 1. Slide to the right (+100px) -> Widen
  firePointer(widthHandle, "pointerdown", 500, 500);
  firePointer(widthHandle, "pointermove", 600, 500);
  expect(Number.parseFloat(wrapper.style.top)).toBeCloseTo(initTop, 2);
  expect(bubble.fontSizeMultiplier).toBe(1);
  firePointer(widthHandle, "pointerup", 600, 500);
  expect(bubble.layoutAdjustment?.bw).toBeCloseTo(300, 1);

  // 2. Slide left past the complete-word floor; the frame stops above 100px.
  firePointer(widthHandle, "pointerdown", 600, 500);
  firePointer(widthHandle, "pointermove", 400, 500);
  expect(Number.parseFloat(wrapper.style.top)).toBeCloseTo(initTop, 2);
  expect(bubble.fontSizeMultiplier).toBe(1);
  firePointer(widthHandle, "pointerup", 400, 500);
  expect(bubble.layoutAdjustment?.bw).toBeGreaterThan(100);
  expect(bubble.layoutAdjustment?.bw).toBeLessThan(300);
  expect(bubble.layoutAdjustment?.bh).toBeGreaterThanOrEqual(140);
});

test("allows narrowing a multi-line oval Thai bubble with the width handle when middle lines are wider than the balloon", async () => {
  const text =
    "เปลี่ยน บรรยากาศจากตัว ตนที่ยอมจำนนของเธอ บ้างสิ! หลังจากนี้ เดี๋ยว เธอจะได้เป็นแม่คนใน พริบตาเดียวแน่ เชื่อฉันสิ!";
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh(text, {
    layoutAdjustment: { bx: 100, by: 100, bw: 180, bh: 260, iw: 1000, ih: 1200 },
    targetFontSize: 16,
    fontSizeMultiplier: 1,
  });
  mockCanvasRect(container);
  const widthHandle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  widthHandle.setPointerCapture = vi.fn();
  (widthHandle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  widthHandle.releasePointerCapture = vi.fn();

  firePointer(widthHandle, "pointerdown", 500, 500);
  firePointer(widthHandle, "pointermove", 450, 500);
  firePointer(widthHandle, "pointerup", 450, 500);

  expect(bubble.layoutAdjustment?.bw).toBeCloseTo(130, 1);
  expect(bubble.layoutAdjustment?.bh).toBeGreaterThanOrEqual(260);
  expect(wrapper.dataset.layoutOverflow).toBe("false");
});

test("width preview lays out the text once and draws with the computed live reflow", async () => {
  const text = "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ";
  const { container, chromeRoot, bubble } = await renderOverlayFresh(text, {
    layoutAdjustment: { bx: 100, by: 100, bw: 200, bh: 140, iw: 1000, ih: 1200, manualMinHeightPx: 140 },
    fontSizeMultiplier: 1,
  });
  mockCanvasRect(container);
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  handle.setPointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();

  firePointer(handle, "pointerdown", 500, 500);
  const { layoutBubbleAtFixedFont, resolveCanvasFontFamily } = await import("@/lib/translationOverlay");
  const effectiveFontSize = Math.max(8, Math.round((bubble.targetFontSize ?? 16) * (bubble.fontSizeMultiplier ?? 1)));
  const beforeReferenceLayout = fontAwareMeasureTextCount;
  const expectedLayout = layoutBubbleAtFixedFont(
    text,
    210,
    effectiveFontSize,
    resolveCanvasFontFamily("Itim, sans-serif"),
    true,
    140,
    1100,
    "th",
  );
  const singleLayoutMeasureCount = fontAwareMeasureTextCount - beforeReferenceLayout;
  expect(singleLayoutMeasureCount).toBeGreaterThan(10);

  const beforePreview = fontAwareMeasureTextCount;
  firePointer(handle, "pointermove", 510, 500);
  const previewMeasureCount = fontAwareMeasureTextCount - beforePreview;
  expect(previewMeasureCount).toBeLessThan(singleLayoutMeasureCount * 1.5);
  expect(fillTextSpy.mock.calls.slice(-expectedLayout.lines.length).map(([line]) => String(line)))
    .toEqual(expectedLayout.lines);
  firePointer(handle, "pointerup", 510, 500);
  expect(bubble.layoutSnapshot?.frameWidthPx).toBeCloseTo(bubble.layoutAdjustment!.bw, 2);
  expect(bubble.layoutSnapshot?.lines).toEqual(expectedLayout.lines);
});

test("rotate handle snaps magnetically to cardinal right angles (0, 90, 180, 270) within 6 degrees", async () => {
  const { container, chromeRoot, bubble, wrapper } = await renderOverlayFresh(
    "ข้อความหมุน",
    {
      layoutAdjustment: { bx: 200, by: 200, bw: 200, bh: 200, iw: 1000, ih: 1200 },
      rotation: 0,
    },
  );
  mockCanvasRect(container);
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
    left: 200, top: 200, right: 400, bottom: 400, width: 200, height: 200,
  } as DOMRect);

  const rotateHandle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="nw"]')!;
  expect(rotateHandle).toBeTruthy();
  rotateHandle.setPointerCapture = vi.fn();
  (rotateHandle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  rotateHandle.releasePointerCapture = vi.fn();

  // Center is at (300, 300). Pointerdown directly above center at (300, 200) -> initial angle is -90 deg.
  firePointer(rotateHandle, "pointerdown", 300, 200);

  // 1. Move slightly clockwise: angleDiff is ~3 deg (within +/- 6 deg of 0) -> should snap to 0 deg
  firePointer(rotateHandle, "pointermove", 305, 200);
  expect(wrapper.style.transform).toBe(""); // 0 deg is empty string in wrapper.style.transform

  // 2. Move to ~45 degrees (outside threshold) -> smooth rotation (not snapped)
  // At (370.7, 229.3): dx = 70.7, dy = -70.7 -> curAngle = -45 deg -> angleDiff = +45 deg
  firePointer(rotateHandle, "pointermove", 371, 229);
  expect(wrapper.style.transform).toMatch(/rotate\(45\.\ddeg\)/);

  // 3. Move near 90 degrees: dx = 100, dy = 5 -> curAngle = ~2.8 deg -> angleDiff = 92.8 deg -> snaps to 90 deg
  firePointer(rotateHandle, "pointermove", 400, 305);
  expect(wrapper.style.transform).toBe("rotate(90.0deg)");

  // 4. Release pointer: commits snapped rotation
  firePointer(rotateHandle, "pointerup", 400, 305);
  expect(bubble.layoutAdjustment?.rotation).toBe(90);

  // 5. Undo restores original rotation 0
  const { undoManager: testUndoManager } = await import("@/lib/undoManager");
  testUndoManager.undo();
  expect(bubble.layoutAdjustment?.rotation).toBe(0);
});


test("renders the identical font and lines for workspace and offscreen export paths", async () => {
  vi.resetModules();
  // Per-canvas draw recorder so single-mode and offscreen renders can be
  // compared without the shared jsdom ctx proxy merging their logs.
  const recordings = new Map<HTMLCanvasElement, { fonts: string[]; lines: string[]; size: [number, number] }>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    let rec = recordings.get(this);
    if (!rec) {
      rec = { fonts: [], lines: [], size: [this.width, this.height] };
      recordings.set(this, rec);
    }
    let curFont = "bold 16px sans-serif";
    const ctx = {
      set font(v: string) { curFont = v; rec!.fonts.push(v); },
      get font() { return curFont; },
      measureText: (str: string) => {
        const match = /(\d+(?:\.\d+)?)px/.exec(curFont);
        const fs = match ? parseFloat(match[1]) : 16;
        return { width: str.length * fs * 0.62 };
      },
      fillText: (text: string) => { rec!.lines.push(String(text)); },
      strokeText: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    };
    return ctx as unknown as CanvasRenderingContext2D;
  });

  const makeContainer = (offscreen: boolean) => {
    const container = document.createElement("div");
    if (offscreen) container.id = "offscreen-container";
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 1200 },
    });
    container.appendChild(image);
    document.body.appendChild(container);
    return container;
  };

  const { applyTranslationOverlay } = await import("@/lib/translationOverlay");
  const styleRef = {
    current: {
      fontFamily: "Itim, sans-serif",
      textColor: "#000000",
      textOutline: "#ffffff",
      fontSizeMultiplier: 1,
    },
  };
  const bubble: TranslatedBubble = {
    box: [100, 100, 300, 400],
    t: "โอ้ ดูท่าทางจะใช้ได้แฮะ",
    layoutAdjustment: { bx: 300, by: 300, bw: 200, bh: 360, iw: 1000, ih: 1200 },
    targetFontSize: 24,
  };

  const liveContainer = makeContainer(false);
  await applyTranslationOverlay(
    [{ ...bubble }],
    "single",
    0,
    vi.fn(),
    undefined,
    styleRef,
    liveContainer, undefined, undefined, "th",
  );
  await vi.runAllTimersAsync();

  const exportContainer = makeContainer(true);
  await applyTranslationOverlay(
    [{ ...bubble }],
    "offscreen",
    -1,
    vi.fn(),
    undefined,
    styleRef, undefined, undefined, undefined, "th",
  );
  await vi.runAllTimersAsync();

  const liveCanvas = liveContainer.querySelector("canvas")!;
  const exportCanvas = exportContainer.querySelector("canvas")!;
  const live = recordings.get(liveCanvas)!;
  const exported = recordings.get(exportCanvas)!;

  // The exported page must draw the exact same glyph size, line breaks and
  // frame as the workspace bubble.
  expect(live.fonts).toEqual(exported.fonts);
  expect(live.lines).toEqual(exported.lines);
  expect(exported.size).toEqual(live.size);
  expect(live.lines.length).toBeGreaterThan(0);
});

test("canceling a draft review decision marks restored state dirty for autosave", async () => {
  const changed=vi.fn();
  const {chromeRoot,bubble}=await renderOverlay("รอตรงนี้",{
    original_text:"Wait here.",translationReview:{status:"suggested",sourceText:"Wait here.",reviewedText:"รอตรงนี้",suggestion:"รอที่นี่"},
  },{onBubblesMutated:changed});
  chromeRoot.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-review-action="dismiss"]')!.click();
  expect(bubble.translationReview?.status).toBe("dismissed");
  changed.mockClear();
  document.querySelector<HTMLButtonElement>('[aria-label="ยกเลิกการแก้ไข"]')!.click();
  expect(bubble.translationReview?.status).toBe("suggested");
  expect(changed).toHaveBeenCalledOnce();
});

test("export compositing survives a font-load rejection", async () => {
  const { container, canvas } = await renderOverlay("ฟอนต์พังก็ export ได้");
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn().mockRejectedValue(new Error("invalid font-family")) },
  });

  const drawImageArgs: unknown[][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {
        measureText: () => ({ width: 20 }),
        drawImage: (...args: unknown[]) => {
          drawImageArgs.push(args);
        },
      },
      {
        get(target, property) {
          if (property in target) {
            return target[property as keyof typeof target];
          }
          return vi.fn();
        },
        set(target, property, value) {
          return Reflect.set(target as Record<PropertyKey, unknown>, property, value);
        },
      },
    ) as unknown as CanvasRenderingContext2D,
  );

  downloadTranslatedImage("single", 0, "export.png", true, container);
  await Promise.resolve();
  await Promise.resolve();

  expect(drawImageArgs.some((args) => args[0] === canvas)).toBe(true);
});
