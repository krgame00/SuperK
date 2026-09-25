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
    expect(bubble.style.textShadow).toContain('rgba(30, 30, 30, 0.80)');
  });

  it('keeps source outline separate from the uniform shadow and respects Manual Off', () => {
    const app = setup();
    app.send({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: 'fake-png',
      bubbles: [
        {
          t: 'มีเงามาตรฐาน',
          box: [50, 50, 200, 200],
          styleProfile: {
            fill: '#ffffff',
            outline: '#ff3366',
            hasOutline: true,
            outlineWidthRatio: 0.12,
            source: 'auto',
            ownershipMode: 'auto',
            shadow: { color: '#00ff00', opacity: 1, blurRatio: 1, offsetXRatio: 1, offsetYRatio: 1 },
            glow: { color: '#00ffff', opacity: 1, blurRatio: 1, offsetXRatio: 0, offsetYRatio: 0 },
          },
        },
        {
          t: 'ปิดเงา',
          box: [250, 50, 400, 200],
          styleProfile: {
            fill: '#ffffff',
            outline: '#3366ff',
            hasOutline: true,
            source: 'manual',
            ownershipMode: 'manual',
            manualShadowMode: 'off',
          },
        },
      ],
    });

    const rendered = Array.from(document.querySelectorAll<HTMLElement>('.superk-text-bubble'));
    expect(rendered).toHaveLength(2);
    expect(rendered[0].style.textShadow).toContain('#ff3366');
    expect(rendered[0].style.textShadow).toContain('rgba(30, 30, 30, 0.80)');
    expect(rendered[0].style.textShadow).not.toContain('#00ff00');
    expect(rendered[1].style.textShadow).toContain('#3366ff');
    expect(rendered[1].style.textShadow).not.toContain('rgba(30, 30, 30, 0.80)');
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
    const bubble = document.querySelector<HTMLElement>('.superk-text-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent?.replace(/\s+/g, '')).toContain('คำแปลเดิม');
    expect(bubble?.style.textShadow).toContain('rgba(30, 30, 30, 0.80)');
  });

  it('renders confirmed monochrome dialogue with black/white text and no automatic shadow', () => {
    const app = setup();
    app.send({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: 'fake-png',
      pageStyle: {
        isMonochromePage: true,
        monochromeConfidence: 0.95,
      },
      bubbles: [
        {
          t: 'ฟองขาวบนหน้าขาวดำ',
          box: [50, 50, 200, 200],
          styleProfile: {
            fill: '#000000',
            outline: '#ffffff',
            backgroundLuminance: 245,
            isMonochromePage: true,
            monochromeConfidence: 0.95,
            category: 'dialogue',
          },
        },
        {
          t: 'ฟองดำบนหน้าขาวดำ',
          box: [250, 50, 400, 200],
          styleProfile: {
            fill: '#ffffff',
            outline: '#000000',
            backgroundLuminance: 20,
            isMonochromePage: true,
            monochromeConfidence: 0.95,
            category: 'dialogue',
          },
        },
      ],
    });

    const rendered = Array.from(document.querySelectorAll<HTMLElement>('.superk-text-bubble'));
    expect(rendered).toHaveLength(2);

    // Light bubble -> black text, no shadow
    expect(rendered[0].style.color).toBe('rgb(0, 0, 0)');
    expect(rendered[0].style.textShadow).toBe('none');

    // Dark bubble -> black text, no shadow
    expect(rendered[1].style.color).toBe('rgb(0, 0, 0)');
    expect(rendered[1].style.textShadow).toBe('none');
  });

  it('restores monochrome text styling without shadow from cached local storage', async () => {
    localStorageMock['superk_trans_https://manga.test/cached-mono.png'] = {
      imageUrl: 'https://manga.test/cached-mono.png',
      bubbles: [
        {
          t: 'แคชขาวดำ',
          box: [20, 20, 150, 150],
          styleProfile: {
            isMonochromePage: true,
            monochromeConfidence: 0.95,
            backgroundLuminance: 240,
            category: 'dialogue',
          },
        },
      ],
      pageStyle: {
        isMonochromePage: true,
        monochromeConfidence: 0.95,
      },
      cleanMode: 'inpainting',
      cleanImageBase64: 'cached-clean-bg',
      textStyle: { fontFamily: 'Prompt' },
    };

    setup('https://manga.test/cached-mono.png');

    await new Promise(r => setTimeout(r, 200));

    const bubble = document.querySelector<HTMLElement>('.superk-text-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.style.color).toBe('rgb(0, 0, 0)');
    expect(bubble?.style.textShadow).toBe('none');
  });

  it('suppresses the standard shadow on confirmed monochrome dialogue even when region luminance is unavailable', () => {
    const app = setup();
    app.send({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: 'fake-png',
      pageStyle: { isMonochromePage: true, monochromeConfidence: 0.96 },
      bubbles: [
        {
          t: 'ไม่มีค่า luminance',
          box: [50, 50, 200, 200],
          styleProfile: {
            fill: '#000000',
            isMonochromePage: true,
            monochromeConfidence: 0.96,
            category: 'dialogue',
          },
        },
      ],
    });

    const bubble = document.querySelector<HTMLElement>('.superk-text-bubble')!;
    expect(bubble.style.textShadow).not.toContain('rgba(30, 30, 30, 0.80)');
  });

  it.each(['dialogue', 'narration', 'sfx', 'overlay_subtitle'])('renders monochrome %s as black without effects', category => {
    const app = setup();
    app.send({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: 'fake-png',
      bubbles: [
        {
          t: 'พื้นหลังขาวดำสลับกัน',
          box: [50, 50, 200, 200],
          styleProfile: {
            fill: '#000000',
            backgroundLuminance: 220,
            backgroundLuminanceSamples: [35, 225, 50, 235],
            isMonochromePage: true,
            monochromeConfidence: 0.96,
            category,
          },
        },
      ],
    });

    const bubble = document.querySelector<HTMLElement>('.superk-text-bubble')!;
    expect(bubble.style.color).toBe('rgb(0, 0, 0)');
    expect(bubble.style.textShadow).toBe('none');
    expect(bubble.style.textShadow).not.toContain('rgba(30, 30, 30, 0.80)');
  });

  it('does not preserve an untrusted source outline on a plain monochrome light bubble', () => {
    const app = setup();
    app.send({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: 'fake-png',
      bubbles: [
        {
          t: 'ขอบที่ไม่ผ่าน evidence gate',
          box: [50, 50, 200, 200],
          styleProfile: {
            fill: '#000000',
            outline: '#ff3366',
            hasOutline: true,
            outlineConfidence: 0.25,
            evidenceState: 'rejected',
            backgroundLuminance: 240,
            isMonochromePage: true,
            monochromeConfidence: 0.96,
            category: 'dialogue',
          },
        },
      ],
    });

    const bubble = document.querySelector<HTMLElement>('.superk-text-bubble')!;
    expect(bubble.style.textShadow).toBe('none');
  });
});
