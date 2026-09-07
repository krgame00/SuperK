import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';

const script = readFileSync('chrome-extension/content.js', 'utf8');
afterEach(() => {
  document.querySelector<HTMLButtonElement>('[data-action="close"]')?.click();
  document.body.innerHTML = '';
  delete (globalThis as Record<string, unknown>).__superKLoaded;
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  let listener: (message: unknown) => void;
  const addListener = vi.fn(fn => { listener = fn; });
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener } } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, {
    get: () => vi.fn(),
  }) as CanvasRenderingContext2D);
  document.body.innerHTML = '<img src="https://manga.test/page.png">';
  const img = document.querySelector('img')!;
  const rect = { top: 0, left: 0, width: 600, height: 900 };
  vi.spyOn(img, 'getBoundingClientRect').mockImplementation(() => ({ ...rect }) as DOMRect);
  window.eval(script);
  return { rect, addListener, send: (message: object) => listener({ imageUrl: img.src, ...message }) };
}

it('hides both white mask and translation when showing the original, and scales both on resize', () => {
  const app = setup();
  app.send({ action: 'TRANSLATION_SUCCESS', cleanMode: 'solid', bubbles: [{ t: 'สวัสดี', box: [0, 0, 200, 200] }] });
  const canvas = document.querySelector('canvas')!;
  const layer = canvas.parentElement!;
  document.querySelector<HTMLButtonElement>('[data-action="toggle"]')!.click();
  expect(layer.style.visibility).toBe('hidden');
  document.querySelector<HTMLButtonElement>('[data-action="toggle"]')!.click();
  expect(layer.style.visibility).toBe('visible');
  app.rect.width = 300; app.rect.height = 450;
  window.dispatchEvent(new Event('resize'));
  expect(layer.style.width).toBe('600px');
  expect(layer.style.transform).toBe('scale(0.5, 0.5)');
  document.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
  expect(document.querySelector('.superk-overlay-container')).toBeNull();
});

it('does not add a white mask in stroke mode and tolerates reinjection', () => {
  const app = setup(); window.eval(script);
  expect(app.addListener).toHaveBeenCalledTimes(1);
  app.send({ action: 'TRANSLATION_SUCCESS', cleanMode: 'stroke', bubbles: [{ t: 'x', box: [0, 0, 100, 100] }] });
  expect(document.querySelector('canvas')).toBeNull();
  expect(document.querySelector('.superk-text-bubble')).not.toBeNull();
});

it('renders inpainted clean image without flat white canvas mask when cleanImageBase64 is provided', () => {
  const app = setup();
  app.send({
    action: 'TRANSLATION_SUCCESS',
    cleanMode: 'inpainting',
    cleanImageBase64: 'fake-png-data',
    bubbles: [{ t: 'สวัสดีชาวโลก', box: [10, 10, 200, 200] }],
  });
  expect(document.querySelector('.superk-clean-image')).not.toBeNull();
  expect(document.querySelector('canvas')).toBeNull();
  expect(document.querySelector('.superk-text-bubble')).not.toBeNull();
});

it('renders an actionable error badge with a retry button on translation error', () => {
  const app = setup();
  const sendMessageMock = vi.fn();
  (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

  app.send({ action: 'TRANSLATION_ERROR', error: 'Inpainting failed: backend offline' });
  const badge = document.querySelector('.superk-error')!;
  expect(badge).not.toBeNull();
  expect(badge.textContent).toContain('Inpainting failed');

  const retryBtn = badge.querySelector<HTMLButtonElement>('button[data-action="retry"]')!;
  expect(retryBtn).not.toBeNull();
  retryBtn.click();
  expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({
    action: 'RETRY_TRANSLATE',
    imageUrl: 'https://manga.test/page.png',
  }));
});

it('renders centered loading scrim overlay without mutating img.parentElement.style.position on TRANSLATION_START', () => {
  const app = setup();
  const img = document.querySelector('img')!;
  const initialParentPosition = img.parentElement?.style.position || '';

  app.send({ action: 'TRANSLATION_START' });

  // Verify zero parent style mutation (no unwanted scrollbar)
  expect(img.parentElement?.style.position).toBe(initialParentPosition);

  // Verify centered loading scrim container on document.body
  const scrimContainer = document.querySelector<HTMLElement>('.superk-loading-scrim-container')!;
  expect(scrimContainer).not.toBeNull();
  expect(scrimContainer.style.position).toBe('absolute');
  expect(scrimContainer.style.overflow).toBe('hidden');
  expect(scrimContainer.style.width).toBe('600px');
  expect(scrimContainer.style.height).toBe('900px');

  // Verify centered loading card and SuperK emblem
  const card = scrimContainer.querySelector('.superk-loading-card')!;
  expect(card).not.toBeNull();
  expect(card.querySelector('.superk-loading-logo')).not.toBeNull();
  expect(card.querySelector('.superk-loading-ring')).not.toBeNull();
  expect(card.textContent).toContain('กำลังแปล');
});

it('activates compact mode for small panels (< 180px) and hides text', () => {
  const app = setup();
  app.rect.width = 120;
  app.rect.height = 150;

  app.send({ action: 'TRANSLATION_START' });

  const scrimContainer = document.querySelector<HTMLElement>('.superk-loading-scrim-container')!;
  expect(scrimContainer).not.toBeNull();
  expect(scrimContainer.classList.contains('superk-compact')).toBe(true);
});

it('cleans up loading scrim when translation succeeds or encounters an error', () => {
  const app = setup();

  // Start -> loading scrim exists
  app.send({ action: 'TRANSLATION_START' });
  expect(document.querySelector('.superk-loading-scrim-container')).not.toBeNull();

  // Success -> loading scrim removed
  app.send({ action: 'TRANSLATION_SUCCESS', cleanMode: 'stroke', bubbles: [{ t: 'เสร็จสิ้น', box: [0, 0, 50, 50] }] });
  expect(document.querySelector('.superk-loading-scrim-container')).toBeNull();

  // Start again -> loading scrim exists
  app.send({ action: 'TRANSLATION_START' });
  expect(document.querySelector('.superk-loading-scrim-container')).not.toBeNull();

  // Error -> loading scrim removed and error displayed
  app.send({ action: 'TRANSLATION_ERROR', error: 'ข้อผิดพลาดทดสอบ' });
  expect(document.querySelector('.superk-loading-scrim-container')).toBeNull();
  expect(document.querySelector('.superk-error')).not.toBeNull();
});


