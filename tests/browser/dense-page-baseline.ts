import { applyTranslationOverlay, type TranslatedBubble } from '../../lib/translationOverlay';
import { SOURCE_SIZE_POLICY } from '../../lib/sourceTextSize';
import { undoManager } from '../../lib/undoManager';

// Diagnostic instrumentation only. Preview latency ends after the renderer's queued
// rAF callback and a geometry read; it is not a compositor presentation timestamp.
const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Cost = { calls: number; ms: number };
let costs: Record<string, Cost> = {};
function instrument(object: object, key: string) {
  const target = object as Record<string, (...args: unknown[]) => unknown>;
  const original = target[key];
  target[key] = function(this: unknown, ...args: unknown[]) {
    const start = performance.now();
    try { return original.apply(this, args); }
    finally { const cost = costs[key] ??= { calls: 0, ms: 0 }; cost.calls++; cost.ms += performance.now() - start; }
  };
}
const diagnostic = new URLSearchParams(location.search).get('diagnostic') === '1';
if (diagnostic) {
  for (const key of ['measureText', 'fillText', 'strokeText', 'getImageData']) instrument(CanvasRenderingContext2D.prototype, key);
  instrument(Element.prototype, 'getBoundingClientRect');
  instrument(Storage.prototype, 'setItem');
}
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, p50: sorted[Math.floor((sorted.length - 1) * .5)],
    p95: sorted[Math.ceil((sorted.length - 1) * .95)], max: sorted.at(-1) };
};
async function run() {
  const rows = [];
  for (const [iw, ih] of [[1000, 1400], [1600, 2400]]) for (const count of [10, 50, 100]) for (const zoom of [.44, 1]) {
    for (const gesture of ['move', 'scale', 'width']) {
      document.body.replaceChildren(); undoManager.clear(); localStorage.clear();
      const viewport = document.createElement('div'); viewport.style.cssText = `position:relative;width:${iw}px;height:${ih}px`;
      const stage = document.createElement('div'); stage.style.cssText = `position:relative;width:${iw}px;height:${ih}px;transform:scale(${zoom});transform-origin:0 0`;
      const chrome = document.createElement('div'); chrome.dataset.overlayChromeLayer = 'true';
      chrome.style.cssText = 'position:absolute;inset:0;pointer-events:none';
      const image = new Image(); image.width = iw; image.height = ih;
      image.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${iw}" height="${ih}"><rect width="100%" height="100%" fill="#ddd"/></svg>`);
      await image.decode(); stage.append(image); viewport.append(stage, chrome); document.body.append(viewport);
      const bubbles: TranslatedBubble[] = Array.from({ length: count }, (_, i) => {
        const bx = i === 0 ? 100 : (i % 10) * (iw / 10), by = i === 0 ? 300 : Math.floor(i / 10) * (ih / 10);
        const bw = i === 0 ? 320 : iw / 10, bh = i === 0 ? 460 : ih / 10;
        const text = i === 0 ? 'เมื่อเรื่องราวที่ยาวนานเริ่มต้นขึ้น\nทุกคนต่างเฝ้ารอวันที่จะได้พบกันอีกครั้ง\nเพราะความทรงจำเหล่านั้นยังอยู่ในใจเสมอ\nและพวกเราจะก้าวเดินไปด้วยกันต่อไป' : 'ความทรงจำ\nยังอยู่ในใจ\nเสมอไป';
        const box = [bx, by, bx + bw, by + bh];
        return { t: text,
          box, targetFontSize: i === 0 ? 26 : 14,
          ...(i === 0 ? { sourceSizing: {
            mode: 'auto' as const, status: 'matched' as const, baseFontSizePx: 26,
            font: { family: 'sans-serif', textKey: text, referencePx: 26, bodyHeightPx: 16, loaded: true },
            evidence: { policyVersion: SOURCE_SIZE_POLICY, sourceRevision: 'p03-source-v1',
              regionKey: box.join(','), pixelRevision: 'p03-pixels-v1',
              rect: { x: bx, y: by, width: bw, height: 160 }, quality: 'reliable' as const,
              confidence: .9, reason: 'glyphs', bodyHeightPx: 16, glyphCount: 24, lineCount: 4 },
          } } : {}),
          styleProfile: { fill: '#000000', outline: '#ffffff', hasOutline: true, outlineWidthRatio: .12,
            fillConfidence: 1, outlineConfidence: 1, source: 'manual', ownershipMode: 'manual', manualShadowMode: 'standard' },
          layoutAdjustment: { bx, by, bw, bh, iw, ih, manualMinHeightPx: bh } };
      });
      await applyTranslationOverlay(bubbles, 'single', 0, () => {}, undefined,
        { current: { fontFamily: 'sans-serif', textColor: '#000000', textOutline: '#ffffff', fontSizeMultiplier: 1 } }, stage,
        undefined, undefined, 'th');
      await wait(300);
      const wrapper = stage.querySelector<HTMLElement>('.translation-bubble-wrapper')!;
      const frame = wrapper.querySelector<HTMLElement>('.bubble-text-selection')!;
      frame.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      frame.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      await wait(150);
      const handle = chrome.querySelector<HTMLElement>(`.action-handle--${gesture}`)!;
      if (!handle) throw new Error(`Missing ${gesture} handle`);
      handle.setPointerCapture = () => {}; handle.releasePointerCapture = () => {}; handle.hasPointerCapture = () => true;
      const rect = handle.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const fire = (type: string, dx: number, dy: number) => handle.dispatchEvent(new PointerEvent(type,
        { bubbles: true, pointerId: 1, clientX: x + dx * zoom, clientY: y + dy * zoom }));
      const frames: number[] = [], latency: number[] = []; costs = {};
      const label = `${iw}x${ih}/${count}/${zoom}/${gesture}`;
      performance.mark(`${label}/drag-start`);
      fire('pointerdown', 0, 0);
      let previous = await nextFrame();
      const started = performance.now();
      // 60 frame-paced inputs, each moving 1 page pixel. rAF callback queues
      // renderer preview first; the awaited callback reads its visible geometry.
      for (let i = 1; i <= 60; i++) {
        const input = performance.now(); fire('pointermove', i, gesture === 'scale' ? -i : gesture === 'move' ? i / 2 : 0);
        const now = await nextFrame();
        wrapper.getBoundingClientRect(); latency.push(performance.now() - input);
        frames.push(now - previous); previous = now;
      }
      performance.mark(`${label}/drag-end`);
      const dragCosts = structuredClone(costs); costs = {};
      const preview = wrapper.style.cssText;
      const releaseStart = performance.now(); performance.mark(`${label}/release-start`);
      fire('pointerup', 60, gesture === 'scale' ? -60 : gesture === 'move' ? 30 : 0);
      const releaseHandlerMs = performance.now() - releaseStart;
      await nextFrame(); await nextFrame();
      performance.mark(`${label}/release-end`);
      rows.push({ label, iw, ih, count, zoom, gesture, durationMs: performance.now() - started,
        framesMs: distribution(frames), missedFrames60Hz: frames.reduce((n, ms) => n + Math.max(0, Math.round(ms / (1000 / 60)) - 1), 0),
        inputToPreviewMs: distribution(latency), releaseHandlerMs, releaseToSecondFrameMs: performance.now() - releaseStart,
        dragCosts, releaseCosts: structuredClone(costs), preview, settled: wrapper.style.cssText });
      console.log('Completed', label);
    }
  }
  return { ok: true, diagnostic, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio, latencyDefinition: 'dispatch to queued preview callback completion plus geometry read; excludes compositor presentation', rows };
}
(window as unknown as { denseBaseline: Promise<unknown> }).denseBaseline = run().catch(error => ({ ok: false, error: String(error), stack: error.stack }));
