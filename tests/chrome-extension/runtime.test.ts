// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

const read = (name: string) => readFileSync(`chrome-extension/${name}`, 'utf8');
function setup(options: {
  direct?: boolean;
  failImage?: boolean;
  failServer?: boolean;
  modelPreference?: string;
  directResponses?: Array<{ status?: number; data?: any }>;
} = {}) {
  let click: (info: unknown, tab: unknown) => Promise<void>;
  const sendMessage = vi.fn().mockResolvedValue({});
  let directCallCount = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url === 'https://manga.test/page.png') return new Response(new Uint8Array([0, 127, 255]), {
      status: options.failImage ? 403 : 200, headers: { 'Content-Type': 'image/png' },
    });
    if (url.includes('/api/extension/settings')) {
      if (options.failServer) return Response.json({ error: 'Missing server key' }, { status: 500 });
      return Response.json({
        geminiApiKey: 'test-key',
        modelHierarchy: [],
        allowPreviewModels: false,
        cleanMode: 'solid',
        textStyle: { fontFamily: 'Itim, sans-serif', fontSizeMultiplier: 1.0, textColor: '#000000', textOutline: '#FFFFFF' },
      });
    }
    if (url === 'https://generativelanguage.googleapis.com/v1beta/models') {
      return Response.json({ models: [{ name: 'models/gemini-dynamic-test', supportedGenerationMethods: ['generateContent'] }] });
    }
    if (options.failServer) return Response.json({ error: 'Missing server key' }, { status: 500 });

    if (options.direct) {
      if (options.directResponses && options.directResponses.length > directCallCount) {
        const item = options.directResponses[directCallCount++];
        return Response.json(item.data ?? {}, { status: item.status ?? 200 });
      }
      const text = JSON.stringify({ bubbles: [{ t: 'สวัสดี', box: [10, 20, 100, 200] }] });
      return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
    }

    const text = JSON.stringify({ bubbles: [{ t: 'สวัสดี', box: [10, 20, 100, 200] }] });
    return Response.json({ text });
  });
  const clearInterval = vi.fn();
  const chrome = {
    runtime: { onInstalled: { addListener: vi.fn() }, getPlatformInfo: vi.fn().mockResolvedValue({}) },
    contextMenus: { create: vi.fn(), onClicked: { addListener: (fn: typeof click) => { click = fn; } } },
    tabs: { sendMessage }, scripting: { insertCSS: vi.fn(), executeScript: vi.fn() },
    storage: { sync: { get: vi.fn(async defaults => ({ ...defaults,
      cleanMode: 'solid',
      ...(options.direct ? { translationMode: 'direct', apiKey: 'test-key', modelPreference: options.modelPreference || 'auto' } : {}),
    })) } },
  };
  const context = vm.createContext({ chrome, fetch, console, URL, Blob, FormData, Uint8Array, btoa, atob, AbortSignal,
    setInterval: vi.fn(() => 1), clearInterval });
  context.importScripts = (file: string) => vm.runInContext(read(file), context);
  vm.runInContext(read('background.js'), context);
  return { context, fetch, sendMessage, clearInterval, chrome,
    run: () => click({ menuItemId: 'superk-translate-image', srcUrl: 'https://manga.test/page.png', frameId: 7 }, { id: 1 }),
  };
}

describe('Chrome extension translation workflow', () => {
  it('loads a PNG without FileReader, calls the existing API, and returns overlays to the selected frame', async () => {
    const app = setup();
    await app.run();
    expect(app.fetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api/translate', expect.anything());
    const translateCall = app.fetch.mock.calls.find(c => c[0] === 'http://127.0.0.1:3000/api/translate') as unknown as [string, RequestInit];
    const body = JSON.parse(translateCall[1].body as string);
    expect(body).toMatchObject({
      imageBase64: 'AH//', mimeType: 'image/png', targetLang: 'Thai',
      apiKey: 'test-key', allowPreview: false,
    });
    expect(app.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({
      action: 'TRANSLATION_SUCCESS',
      bubbles: [expect.objectContaining({ t: 'สวัสดี', box: [10, 20, 100, 200] })],
      pageStyle: expect.objectContaining({
        isMonochromePage: expect.any(Boolean),
        monochromeConfidence: expect.any(Number),
      }),
    }), { frameId: 7 });
    expect(app.clearInterval).toHaveBeenCalledWith(1);
  });

  it('uses fixed Server hierarchy starting with gemini-3.5-flash-lite without discovering models, and preserves real MIME type', async () => {
    const app = setup({ direct: true });
    await app.run();
    // Direct translation must NOT query dynamic models list before translating
    const listCall = app.fetch.mock.calls.find(c => c[0] === 'https://generativelanguage.googleapis.com/v1beta/models');
    expect(listCall).toBeUndefined();

    // First model attempted MUST be gemini-3.5-flash-lite matching server route
    const generateCalls = app.fetch.mock.calls.filter(c => (c[0] as string).includes(':generateContent')) as unknown as [string, RequestInit][];
    expect(generateCalls.length).toBeGreaterThanOrEqual(1);
    expect(generateCalls[0][0]).toContain('/models/gemini-3.5-flash-lite:generateContent');
    expect(JSON.parse(generateCalls[0][1].body as string).contents[0].parts[1].inline_data.mime_type).toBe('image/png');
    expect((generateCalls[0][1].headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
  });

  it('falls back from 429 to next model in hierarchy (gemini-3.8-flash)', async () => {
    const app = setup({
      direct: true,
      directResponses: [
        { status: 429, data: { error: { message: 'Quota exceeded' } } },
        { status: 200, data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ bubbles: [{ t: 'ผลลัพธ์โมเดลสอง', box: [0, 0, 100, 100] }] }) }] } }] } },
      ],
    });
    await app.run();

    const generateCalls = app.fetch.mock.calls.filter(c => (c[0] as string).includes(':generateContent')) as unknown as [string, RequestInit][];
    expect(generateCalls.length).toBe(2);
    expect(generateCalls[0][0]).toContain('/models/gemini-3.5-flash-lite:generateContent');
    expect(generateCalls[1][0]).toContain('/models/gemini-3.8-flash:generateContent');

    expect(app.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({
      action: 'TRANSLATION_SUCCESS',
      bubbles: [expect.objectContaining({ t: 'ผลลัพธ์โมเดลสอง', box: [0, 0, 100, 100] })],
      pageStyle: expect.objectContaining({
        isMonochromePage: expect.any(Boolean),
        monochromeConfidence: expect.any(Number),
      }),
    }), { frameId: 7 });
  });

  it('respects manual model preference in Direct mode', async () => {
    const app = setup({ direct: true, modelPreference: 'gemini-3-flash' });
    await app.run();

    const generateCalls = app.fetch.mock.calls.filter(c => (c[0] as string).includes(':generateContent')) as unknown as [string, RequestInit][];
    expect(generateCalls.length).toBe(1);
    expect(generateCalls[0][0]).toContain('/models/gemini-3-flash:generateContent');
  });

  it('surfaces Google Safety Filter without hiding as quota error', async () => {
    const app = setup({
      direct: true,
      directResponses: [
        { status: 200, data: { candidates: [{ finishReason: 'SAFETY' }] } },
      ],
    });
    await app.run();

    expect(app.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({
      action: 'TRANSLATION_ERROR',
      error: expect.stringContaining('ตัวกรองความปลอดภัย'),
    }), { frameId: 7 });
  });

  it('does not translate failed image downloads', async () => {
    const app = setup({ failImage: true }); await app.run();
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({ action: 'TRANSLATION_ERROR' }), { frameId: 7 });
    expect(app.clearInterval).toHaveBeenCalled();
  });

  it('surfaces backend errors', async () => {
    const app = setup({ failServer: true }); await app.run();
    expect(app.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({ error: 'Missing server key' }), { frameId: 7 });
  });

  it('injects both CSS and script into an already-open tab', async () => {
    const app = setup(); app.sendMessage.mockRejectedValueOnce(new Error('No receiver')); await app.run();
    expect(app.chrome.scripting.insertCSS).toHaveBeenCalledWith({ target: { tabId: 1, frameIds: [7] }, files: ['content.css'] });
    expect(app.chrome.scripting.executeScript).toHaveBeenCalled();
  });

  it('rejects invalid server URLs and malformed AI coordinates', () => {
    const { context } = setup();
    for (const url of ['javascript:alert(1)', 'https://user:pass@test.com', 'https://test.com?key=secret']) {
      expect(() => context.SuperKServer.normalizeUrl(url)).toThrow();
    }
    expect(context.SuperKServer.normalizeUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(() => context.SuperKServer.parseResult('{"bubbles":[{"t":"x","box":[0,0,1001,2]}]}')).toThrow();
  });
});

