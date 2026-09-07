import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const script = readFileSync('chrome-extension/content.js', 'utf8');

describe('Adaptive Speech Bubble Overlay & Local Persistence (Ticket 03)', () => {
  let localStorageMock: Record<string, unknown> = {};

  beforeEach(() => {
    localStorageMock = {};
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>).__superKLoaded;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>).__superKLoaded;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(imageUrl = 'https://manga.test/page1.png') {
    let listener: (message: unknown) => void;
    const addListener = vi.fn((fn: any) => { listener = fn; });
    const sendMessage = vi.fn();

    const chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
      storage: {
        local: {
          get: vi.fn(async (key: string | string[] | Record<string, unknown>) => {
            if (typeof key === 'string') return { [key]: localStorageMock[key] };
            if (Array.isArray(key)) {
              const res: Record<string, unknown> = {};
              for (const k of key) res[k] = localStorageMock[k];
              return res;
            }
            return { ...localStorageMock };
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(localStorageMock, items);
          }),
          remove: vi.fn(async (key: string) => {
            delete localStorageMock[key];
          }),
        },
      },
    };

    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, {
      get: () => vi.fn(),
    }) as CanvasRenderingContext2D);

    document.body.innerHTML = `<img src="${imageUrl}">`;
    const img = document.querySelector('img')!;
    const rect = { top: 0, left: 0, width: 600, height: 900 };
    vi.spyOn(img, 'getBoundingClientRect').mockImplementation(() => ({ ...rect }) as DOMRect);

    window.eval(script);

    return {
      img,
      rect,
      chrome,
      sendMessage,
      send: (message: object) => listener({ imageUrl, ...message }),
    };
  }

  it('renders speech bubbles with adaptive text styling from SuperK settings', () => {
    const app = setup();
    app.send({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: 'fake-png',
      textStyle: {
        fontFamily: 'Sarabun, sans-serif',
        fontSizeMultiplier: 1.2,
        textColor: '#222222',
        textOutline: '#DDDDDD',
      },
      bubbles: [
        { t: 'สวัสดีครับผมยินดีที่ได้รู้จักทุกคนนะครับ', box: [50, 50, 200, 200] },
      ],
    });

    const bubble = document.querySelector<HTMLElement>('.superk-text-bubble')!;
    expect(bubble).not.toBeNull();
    expect(bubble.textContent).toContain('สวัสดี');
    expect(bubble.style.color).toBe('rgb(34, 34, 34)'); // #222222
  });

  it('persists translation in chrome.storage.local and provides Delete and Retranslate actions', async () => {
    const app = setup('https://manga.test/saved-page.png');
    app.send({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: 'saved-clean-bg',
      bubbles: [{ t: 'ข้อความบันทึก', box: [10, 10, 100, 100] }],
    });

    // Verify saved to local storage
    expect(app.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'superk_trans_https://manga.test/saved-page.png': expect.objectContaining({
          imageUrl: 'https://manga.test/saved-page.png',
          cleanImageBase64: 'saved-clean-bg',
        }),
      })
    );

    // Verify controls include Retranslate and Delete
    const retranslateBtn = document.querySelector<HTMLButtonElement>('[data-action="retranslate"]')!;
    expect(retranslateBtn).not.toBeNull();
    retranslateBtn.click();
    expect(app.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RETRY_TRANSLATE',
      imageUrl: 'https://manga.test/saved-page.png',
    }));

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-action="delete"]')!;
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();

    expect(app.chrome.storage.local.remove).toHaveBeenCalledWith('superk_trans_https://manga.test/saved-page.png');
    expect(document.querySelector('.superk-overlay-container')).toBeNull();
  });

  it('auto-restores saved translation overlay from chrome.storage.local on page load', async () => {
    localStorageMock['superk_trans_https://manga.test/cached-manga.png'] = {
      imageUrl: 'https://manga.test/cached-manga.png',
      bubbles: [{ t: 'คำแปลเดิมที่เคยแคชไว้', box: [20, 20, 150, 150] }],
      cleanMode: 'inpainting',
      cleanImageBase64: 'cached-clean-bg',
      textStyle: { fontFamily: 'Prompt' },
    };

    setup('https://manga.test/cached-manga.png');

    // Allow the setTimeout in content.js to fire
    await new Promise(r => setTimeout(r, 200));

    expect(document.querySelector('.superk-clean-image')).not.toBeNull();
    const bubble = document.querySelector('.superk-text-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent?.replace(/\s+/g, '')).toContain('คำแปลเดิม');
  });
});
