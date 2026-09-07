// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

const read = (name: string) => readFileSync(`chrome-extension/${name}`, 'utf8');
function setup(options: { direct?: boolean; failImage?: boolean; failServer?: boolean } = {}) {
  let click: (info: unknown, tab: unknown) => Promise<void>;
  const sendMessage = vi.fn().mockResolvedValue({});
  const fetch = vi.fn(async (url: string) => {
    if (url === 'https://manga.test/page.png') return new Response(new Uint8Array([0, 127, 255]), {
      status: options.failImage ? 403 : 200, headers: { 'Content-Type': 'image/png' },
    });
    if (url.includes('/api/extension/settings')) {
      if (options.failServer) return Response.json({ error: 'Missing server key' }, { status: 500 });
      return Response.json({
        geminiApiKey: 'test-key',
        modelHierarchy: ['gemini-3.5-flash-lite'],
        cleanMode: 'solid',
        textStyle: { fontFamily: 'Itim, sans-serif', fontSizeMultiplier: 1.0, textColor: '#000000', textOutline: '#FFFFFF' },
      });
    }
    if (options.failServer) return Response.json({ error: 'Missing server key' }, { status: 500 });
    const text = JSON.stringify({ bubbles: [{ t: 'สวัสดี', box: [10, 20, 100, 200] }] });
    return Response.json(options.direct ? { candidates: [{ content: { parts: [{ text }] } }] } : { text });
  });
  const clearInterval = vi.fn();
  const chrome = {
    runtime: { onInstalled: { addListener: vi.fn() }, getPlatformInfo: vi.fn().mockResolvedValue({}) },
    contextMenus: { create: vi.fn(), onClicked: { addListener: (fn: typeof click) => { click = fn; } } },
    tabs: { sendMessage }, scripting: { insertCSS: vi.fn(), executeScript: vi.fn() },
    storage: { sync: { get: vi.fn(async defaults => ({ ...defaults,
      cleanMode: 'solid',
      ...(options.direct ? { translationMode: 'direct', apiKey: 'test-key' } : {}),
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
    expect(body).toMatchObject({ imageBase64: 'AH//', mimeType: 'image/png', targetLang: 'Thai' });
    expect(body).not.toHaveProperty('apiKey');
    expect(app.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({
      action: 'TRANSLATION_SUCCESS', bubbles: [{ t: 'สวัสดี', box: [10, 20, 100, 200] }],
    }), { frameId: 7 });
    expect(app.clearInterval).toHaveBeenCalledWith(1);
  });
  it('preserves direct Gemini mode and the real image MIME type', async () => {
    const app = setup({ direct: true }); await app.run();
    const call = app.fetch.mock.calls.find(c => (c[0] as string).includes('generativelanguage.googleapis.com')) as unknown as [string, RequestInit];
    expect(call[0]).toContain('generativelanguage.googleapis.com');
    expect(JSON.parse(call[1].body as string).contents[0].parts[1].inline_data.mime_type).toBe('image/png');
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
