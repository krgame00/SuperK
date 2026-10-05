import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TranslatedBubble } from "@/lib/translationOverlay";
import { undoManager } from "@/lib/undoManager";

let fillTextSpy: ReturnType<typeof vi.fn<CanvasRenderingContext2D["fillText"]>>;
let strokeTextSpy: ReturnType<typeof vi.fn<CanvasRenderingContext2D["strokeText"]>>;
let measureTextCount: number;
let storageWriteCount: number;

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
      storageWriteCount += 1;
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
  measureTextCount = 0;
  storageWriteCount = 0;

  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  });

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {
        measureText: function (this: { font?: string }, str: string) {
          measureTextCount += 1;
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

  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,dHJhbnNsYXRlZA==",
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function freshUndoManager(): Promise<typeof undoManager> {
  const { undoManager: fresh } = await import("@/lib/undoManager");
  return fresh;
}

async function renderCornerFixture(
  text: string,
  overrides: Partial<TranslatedBubble> = {},
  options: { onBubblesMutated?: () => void } = {},
) {
  vi.resetModules();
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

  const { applyTranslationOverlay } = await import("@/lib/translationOverlay");
  const bubble: TranslatedBubble = {
    box: [100, 100, 300, 400],
    t: text,
    layoutAdjustment: { bx: 100, by: 100, bw: 200, bh: 360, iw: 1000, ih: 1200 },
    fontSizeMultiplier: 1,
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
    container, undefined, options.onBubblesMutated, "th",
  );
  await vi.runAllTimersAsync();
  const wrapper = container.querySelector<HTMLElement>(".translation-bubble-wrapper")!;
  const canvas = wrapper.querySelector<HTMLCanvasElement>("canvas")!;
  const handle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="ne"]')!;
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  (handle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  return { container, chromeRoot, wrapper, canvas, bubble, handle };
}

function firePointer(handle: HTMLElement, type: string, x: number, y: number, flushFrame = true): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  handle.dispatchEvent(event);
  if (type === "pointermove" && flushFrame) vi.advanceTimersByTime(16);
}

function mockCanvasRect(container: HTMLElement, zoom = 1): void {
  const tlCanvas = container.querySelector<HTMLElement>(".tl-canvas")!;
  const width = 1000 * zoom;
  const height = 1200 * zoom;
  vi.spyOn(tlCanvas, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: width, bottom: height, width, height,
  } as DOMRect);
}

const canvasFont = (canvas: HTMLCanvasElement): string =>
  (canvas.getContext("2d") as unknown as { font: string }).font;

const fontPx = (font: string): number => {
  const match = /bold ([\d.]+)px/.exec(font);
  if (!match) throw new Error(`unexpected canvas font: ${font}`);
  return parseFloat(match[1]);
};

const mark = (): number => fillTextSpy.mock.calls.length;
const linesSince = (from: number): string[] =>
  fillTextSpy.mock.calls.slice(from).map((call) => String(call[0]));

function selectionSouthWest(wrapper: HTMLElement, rotation = 0) {
  const frame = wrapper.querySelector<HTMLElement>(".bubble-text-selection")!;
  const width = parseFloat(wrapper.style.width) * 10, height = parseFloat(wrapper.style.height) * 12;
  const x = parseFloat(frame.style.left) / 100 * width;
  const y = (parseFloat(frame.style.top) + parseFloat(frame.style.height)) / 100 * height;
  const angle = rotation * Math.PI / 180;
  return { x: parseFloat(wrapper.style.left) * 10 + width / 2 + (x - width / 2) * Math.cos(angle) - (y - height / 2) * Math.sin(angle),
    y: parseFloat(wrapper.style.top) * 12 + height / 2 + (x - width / 2) * Math.sin(angle) + (y - height / 2) * Math.cos(angle) };
}

describe("corner drag bitmap preview", () => {
  test.each([.44,1,1.6])('saved size preview/reopen/export agrees at zoom %s',async zoom=>{
    const {container,canvas,bubble,handle}=await renderCornerFixture('สวัสดีโลก');
    mockCanvasRect(container,zoom);
    firePointer(handle,'pointerdown',300*zoom,100*zoom);
    firePointer(handle,'pointermove',400*zoom,50*zoom);
    firePointer(handle,'pointerup',400*zoom,50*zoom);
    const font=canvasFont(canvas);
    const saved=JSON.parse(JSON.stringify(bubble)) as TranslatedBubble;
    const reopened=await renderCornerFixture('สวัสดีโลก',saved);
    mockCanvasRect(reopened.container,zoom);
    expect(canvasFont(reopened.canvas)).toBe(font);
    expect(reopened.bubble.sourceSizing?.mode).toBe('manual');
    const exported=JSON.parse(JSON.stringify(reopened.bubble)) as TranslatedBubble;
    const {applyTranslationOverlay}=await import('@/lib/translationOverlay');
    await applyTranslationOverlay([exported],'offscreen',0,vi.fn(),vi.fn(),{current:{fontFamily:'Itim, sans-serif',textColor:'#000000',textOutline:'#ffffff',fontSizeMultiplier:1}},reopened.container,undefined,undefined,'th');
    await vi.runAllTimersAsync();
    expect(exported.layoutSnapshot?.fontSizePx).toBe(reopened.bubble.layoutSnapshot?.fontSizePx);
    expect(exported.layoutSnapshot?.lines).toEqual(reopened.bubble.layoutSnapshot?.lines);
  });
  test('legacy direct size gains explicit manual ownership without claiming source measurement',async()=>{
    const {wrapper,bubble}=await renderCornerFixture('hello',{targetFontSize:20});
    wrapper.dispatchEvent(new KeyboardEvent('keydown',{key:'+',bubbles:true}));
    expect(bubble.sourceSizing).toMatchObject({mode:'manual',status:'fallback',evidence:{quality:'unreliable',reason:'user-size-without-source-measurement'}});
  });
  test('corner sizing owns manual mode and Undo restores automatic evidence', async()=>{
    const sizing: NonNullable<TranslatedBubble['sourceSizing']>={mode:'auto',status:'fallback',fallbackLabel:'unavailable',evidence:{policyVersion:'original-body-direction-v2',sourceRevision:'pixels',regionKey:'100,100,300,400',rect:{x:0,y:0,width:10,height:10},pixelRevision:'pixels',quality:'unreliable',confidence:0,reason:'test',glyphCount:0,lineCount:0}};
    const {container,handle,bubble}=await renderCornerFixture('hello',{sourceSizing:sizing});
    const initialSizing=structuredClone(bubble.sourceSizing);
    mockCanvasRect(container);
    firePointer(handle,'pointerdown',300,100);
    firePointer(handle,'pointermove',400,50);
    firePointer(handle,'pointerup',400,50);
    expect(bubble.sourceSizing?.mode).toBe('manual');
    expect(bubble.userTextSpace).toMatchObject({owner:'manual',rect:{width:expect.any(Number),height:expect.any(Number)}});
    (await freshUndoManager()).undo();
    expect(bubble.sourceSizing).toEqual(initialSizing);
    (await freshUndoManager()).redo();
    expect(bubble.sourceSizing?.mode).toBe('manual');
  });
  test("dragging the corner reuses the captured bitmap: zero glyph, stroke or measure work", async () => {
    const { container, wrapper, canvas, handle } = await renderCornerFixture(
      "บรรทัดแรก\nบรรทัดที่สอง",
    );
    mockCanvasRect(container);
    const initialFont = canvasFont(canvas);
    const initialCanvasWidth = Number(canvas.width);
    const initialCanvasHeight = Number(canvas.height);
    const initialWidthPct = parseFloat(wrapper.style.width);
    const initialHeightPct = parseFloat(wrapper.style.height);
    const frame = wrapper.querySelector<HTMLElement>(".bubble-text-selection")!;
    const initialFrameWidthPct = parseFloat(frame.style.width);
    const glyphsBefore = mark();
    const strokesBefore = strokeTextSpy.mock.calls.length;
    const measuresBefore = measureTextCount;

    firePointer(handle, "pointerdown", 500, 500);
    for (let i = 1; i <= 12; i += 1) {
      firePointer(handle, "pointermove", 500 + i * 2, 500 - i * 2);
      expect(fillTextSpy.mock.calls.length).toBe(glyphsBefore);
      expect(strokeTextSpy.mock.calls.length).toBe(strokesBefore);
      expect(measureTextCount).toBe(measuresBefore);
      expect(Number(canvas.width)).toBe(initialCanvasWidth);
      expect(Number(canvas.height)).toBe(initialCanvasHeight);
    }
    // The backing store and its glyphs are untouched; the bitmap is rescaled
    // through proportional CSS sizing instead of being redrawn.
    expect(canvasFont(canvas)).toBe(initialFont);
    expect(parseFloat(wrapper.style.width)).toBeGreaterThan(initialWidthPct);
    expect(parseFloat(wrapper.style.height)).toBeGreaterThan(initialHeightPct);
    // Proportional scaling keeps the tight selection ratio constant.
    expect(parseFloat(frame.style.width)).toBeCloseTo(initialFrameWidthPct, 8);
    firePointer(handle, "pointerup", 524, 476);
  });

  test("release redraws crisply exactly once with the previewed lines, float font and snapshot", async () => {
    const { container, canvas, bubble, handle } = await renderCornerFixture(
      "บรรทัดแรก\nบรรทัดที่สอง",
    );
    mockCanvasRect(container);
    const initialLines = linesSince(0);
    expect(initialLines.length).toBeGreaterThan(0);
    const initialFontPx = fontPx(canvasFont(canvas));

    firePointer(handle, "pointerdown", 500, 500);
    firePointer(handle, "pointermove", 550, 410);
    const glyphsBeforeRelease = mark();
    firePointer(handle, "pointerup", 550, 410);
    await vi.advanceTimersByTimeAsync(32);

    // Exactly one crisp render's worth of glyphs: the same line structure.
    expect(linesSince(glyphsBeforeRelease)).toEqual(initialLines);
    // dx=50, dy=-90 on a 200x360 frame projects to exactly scale 1.25.
    expect(fontPx(canvasFont(canvas))).toBeCloseTo(initialFontPx * 1.25, 6);
    expect(canvasFont(canvas)).toBe(`bold ${initialFontPx * 1.25}px Itim, sans-serif`);
    expect(Number(canvas.width)).toBe(250);
    expect(Number(canvas.height)).toBe(450);

    const snapshot = bubble.layoutSnapshot!;
    expect(snapshot.text).toBe("บรรทัดแรก\nบรรทัดที่สอง");
    expect(snapshot.fontFamily).toBe("Itim, sans-serif");
    expect(snapshot.lines).toEqual(initialLines);
    expect(snapshot.fontSizePx).toBeCloseTo(initialFontPx * 1.25, 6);
    expect(snapshot.frameWidthPx).toBeCloseTo(250, 6);
    expect(snapshot.frameHeightPx).toBeCloseTo(450, 6);
    expect(snapshot.selectionWidth).toBeGreaterThan(0);
    expect(bubble.layoutAdjustment?.layoutSnapshot).toEqual(snapshot);
    expect(bubble.layoutAdjustment?.targetFontSize).toBeTypeOf("number");
  });

  test("a pointer burst commits exactly the latest position once on release", async () => {
    const onBubblesMutated = vi.fn();
    const { container, bubble, handle } = await renderCornerFixture(
      "ปล่อยครั้งเดียว",
      {},
      { onBubblesMutated },
    );
    mockCanvasRect(container);
    const initialLines = linesSince(0);

    firePointer(handle, "pointerdown", 500, 500);
    for (let i = 1; i <= 5; i += 1) firePointer(handle, "pointermove", 500 + i * 8, 500 - i * 8, false);
    const glyphsBeforeRelease = mark();
    // Release coordinates differ from every queued move: the latest must win.
    firePointer(handle, "pointerup", 560, 440);
    await vi.advanceTimersByTimeAsync(32);

    const dx = 60, dy = -60;
    const expectedScale = 1 + (dx * 200 - dy * 360) / (200 * 200 + 360 * 360);
    expect(bubble.layoutAdjustment?.bw).toBeCloseTo(200 * expectedScale, 4);
    expect(bubble.layoutAdjustment?.bh).toBeCloseTo(360 * expectedScale, 4);
    expect(storageWriteCount).toBe(1);
    expect(onBubblesMutated).toHaveBeenCalledTimes(1);
    // Exactly one crisp re-render on release, not one per queued pointer.
    expect(linesSince(glyphsBeforeRelease)).toEqual(initialLines);
  });

  test("rotated corner commit parity holds across Undo/Redo and reopening", async () => {
    const { container, wrapper, canvas, bubble, handle } = await renderCornerFixture("สวัสดีโลก", {
      layoutAdjustment: { bx: 100, by: 100, bw: 200, bh: 360, iw: 1000, ih: 1200, rotation: 30 },
    });
    const undoManager = await freshUndoManager();
    mockCanvasRect(container);
    const initialLines = linesSince(0);
    const initialFont = canvasFont(canvas);
    const initialAnchor = selectionSouthWest(wrapper, 30);

    firePointer(handle, "pointerdown", 500, 500);
    firePointer(handle, "pointermove", 550, 410);
    const releasedMark = mark();
    firePointer(handle, "pointerup", 550, 410);

    const releasedFont = canvasFont(canvas);
    const releasedLines = linesSince(releasedMark);
    const releasedWidth = wrapper.style.width;
    const releasedHeight = wrapper.style.height;
    const releasedAnchor = selectionSouthWest(wrapper, 30);
    expect(releasedAnchor.x).toBeCloseTo(initialAnchor.x, 5);
    expect(releasedAnchor.y).toBeCloseTo(initialAnchor.y, 5);
    const saved = JSON.parse(JSON.stringify(bubble)) as Partial<TranslatedBubble>;

    const undoMark = mark();
    undoManager.undo();
    expect(canvasFont(canvas)).toBe(initialFont);
    expect(linesSince(undoMark)).toEqual(initialLines);
    const restoredAnchor = selectionSouthWest(wrapper, 30);
    expect(restoredAnchor.x).toBeCloseTo(initialAnchor.x, 5);
    expect(restoredAnchor.y).toBeCloseTo(initialAnchor.y, 5);

    const redoMark = mark();
    undoManager.redo();
    expect(canvasFont(canvas)).toBe(releasedFont);
    expect(linesSince(redoMark)).toEqual(releasedLines);
    expect(bubble.layoutAdjustment).toEqual(saved.layoutAdjustment);

    const reopenMark = mark();
    const reopened = await renderCornerFixture("สวัสดีโลก", saved);
    mockCanvasRect(reopened.container);
    expect(reopened.wrapper.style.width).toBe(releasedWidth);
    expect(reopened.wrapper.style.height).toBe(releasedHeight);
    expect(canvasFont(reopened.canvas)).toBe(releasedFont);
    expect(linesSince(reopenMark)).toEqual(releasedLines);
    const reopenedAnchor = selectionSouthWest(reopened.wrapper, 30);
    expect(reopenedAnchor.x).toBeCloseTo(releasedAnchor.x, 5);
    expect(reopenedAnchor.y).toBeCloseTo(releasedAnchor.y, 5);
  });
});

describe("corner preview lifecycle", () => {
  test("canceling a corner bitmap preview restores the exact initial frame without saving", async () => {
    const { container, wrapper, canvas, bubble, handle } = await renderCornerFixture("ยกเลิกการขยาย");
    mockCanvasRect(container);
    const initial = {
      left: wrapper.style.left, top: wrapper.style.top,
      width: wrapper.style.width, height: wrapper.style.height,
    };
    const initialAdjustment = JSON.stringify(bubble.layoutAdjustment);
    const initialFont = canvasFont(canvas);

    firePointer(handle, "pointerdown", 500, 500);
    firePointer(handle, "pointermove", 560, 440);
    expect(wrapper.style.width).not.toBe(initial.width);
    firePointer(handle, "pointercancel", 560, 440);

    expect({
      left: wrapper.style.left, top: wrapper.style.top,
      width: wrapper.style.width, height: wrapper.style.height,
    }).toEqual(initial);
    expect(canvasFont(canvas)).toBe(initialFont);
    expect(JSON.stringify(bubble.layoutAdjustment)).toBe(initialAdjustment);
    expect(storageWriteCount).toBe(0);
    const undoManager = await freshUndoManager();
    expect(undoManager.undo()).toBeNull();
  });

  test("a corner click without movement commits nothing", async () => {
    const { container, wrapper, bubble, handle } = await renderCornerFixture("คลิกเฉยๆ");
    mockCanvasRect(container);
    const initial = {
      left: wrapper.style.left, top: wrapper.style.top,
      width: wrapper.style.width, height: wrapper.style.height,
    };
    const initialAdjustment = JSON.stringify(bubble.layoutAdjustment);

    firePointer(handle, "pointerdown", 500, 500);
    firePointer(handle, "pointerup", 500, 500);

    expect({
      left: wrapper.style.left, top: wrapper.style.top,
      width: wrapper.style.width, height: wrapper.style.height,
    }).toEqual(initial);
    expect(JSON.stringify(bubble.layoutAdjustment)).toBe(initialAdjustment);
    expect(storageWriteCount).toBe(0);
    const undoManager = await freshUndoManager();
    expect(undoManager.undo()).toBeNull();
  });

  test("overlay cleanup during a pending corner preview leaves no stale work", async () => {
    const { container, wrapper, handle } = await renderCornerFixture("เปลี่ยนหน้าขณะขยาย");
    mockCanvasRect(container);
    const initialWidth = wrapper.style.width;
    const glyphsBefore = mark();

    firePointer(handle, "pointerdown", 500, 500);
    firePointer(handle, "pointermove", 560, 440, false);
    const overlay = container.querySelector(".tl-overlay,.tl-canvas") as HTMLElement & {
      _cleanupListeners: () => void;
    };
    overlay._cleanupListeners();
    vi.advanceTimersByTime(32);

    expect(fillTextSpy.mock.calls.length).toBe(glyphsBefore);
    expect(wrapper.style.width).toBe(initialWidth);
    expect(storageWriteCount).toBe(0);
  });
});

describe("proportional snapshot invalidation", () => {
  test("movement and rotation keep the snapshot; text and font edits invalidate it", async () => {
    const { container, wrapper, chromeRoot, bubble, handle } = await renderCornerFixture(
      "ภาพเดิมคงเส้นคงวา",
    );
    mockCanvasRect(container);

    firePointer(handle, "pointerdown", 500, 500);
    firePointer(handle, "pointermove", 550, 410);
    firePointer(handle, "pointerup", 550, 410);
    const committed = bubble.layoutSnapshot!;
    expect(committed.lines.length).toBeGreaterThan(0);

    // Movement keeps the snapshot verbatim.
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await vi.advanceTimersByTimeAsync(16);
    expect(bubble.layoutSnapshot!.fontSizePx).toBe(committed.fontSizePx);
    expect(bubble.layoutSnapshot!.lines).toEqual(committed.lines);

    // A font edit re-typesets and refreshes the snapshot.
    chromeRoot.querySelector<HTMLButtonElement>('[aria-label^="เพิ่มขนาดข้อความ"]')!.click();
    await vi.advanceTimersByTimeAsync(16);
    expect(bubble.layoutSnapshot!.fontSizePx).not.toBe(committed.fontSizePx);
    expect(bubble.layoutSnapshot!.text).toBe(committed.text);

    // A text edit re-wraps and refreshes the identity.
    chromeRoot.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-translation-editor] textarea")!;
    textarea.value = "ข้อความใหม่ทั้งหมด";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(16);
    expect(bubble.layoutSnapshot!.text).toBe("ข้อความใหม่ทั้งหมด");
    expect(bubble.layoutSnapshot!.fontSizePx).not.toBe(committed.fontSizePx);
  });
});


test("a width drag invalidates the captured snapshot and recaptures it for the new frame width", async () => {
  const { container, bubble, chromeRoot } = await renderCornerFixture(
    "บรรทัดแรก\nบรรทัดที่สอง",
  );
  mockCanvasRect(container);
  const widthHandle = chromeRoot.querySelector<HTMLElement>('[data-handle-position="e"]')!;
  widthHandle.setPointerCapture = vi.fn();
  widthHandle.releasePointerCapture = vi.fn();
  (widthHandle as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true;
  const before = bubble.layoutSnapshot!;

  firePointer(widthHandle, "pointerdown", 500, 500);
  firePointer(widthHandle, "pointermove", 560, 500);
  firePointer(widthHandle, "pointerup", 560, 500);
  await vi.advanceTimersByTimeAsync(32);

  const after = bubble.layoutSnapshot!;
  // A width edit is a real layout change: the proportional snapshot must be
  // re-captured for the new frame width with a fresh word wrap at the same
  // font size (the width handle fixed-font contract).
  expect(after.frameWidthPx).toBeGreaterThan(before.frameWidthPx);
  expect(after.frameWidthPx).toBeCloseTo(260, 1);
  expect(after.fontSizePx).toBe(before.fontSizePx);
  expect(after.text).toBe(before.text);
  expect(after.lines).not.toEqual(before.lines);
  expect(bubble.layoutAdjustment?.layoutSnapshot).toEqual(after);
});
