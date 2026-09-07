// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const read = (name: string) => readFileSync(`chrome-extension/${name}`, 'utf8');

describe('SuperK Extension Settings Sync & Caching', () => {
  let localStorageMock: Record<string, unknown> = {};

  beforeEach(() => {
    localStorageMock = {};
  });

  function createServerContext(fetchMock: any) {
    const chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string[] | string | Record<string, unknown>) => {
            if (typeof keys === 'string') {
              return { [keys]: localStorageMock[keys] };
            }
            if (Array.isArray(keys)) {
              const res: Record<string, unknown> = {};
              for (const k of keys) res[k] = localStorageMock[k];
              return res;
            }
            return { ...keys, ...localStorageMock };
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(localStorageMock, items);
          }),
        },
      },
    };

    const context = vm.createContext({
      chrome,
      fetch: fetchMock,
      console,
      URL,
      Date,
      AbortSignal,
      setTimeout,
      clearTimeout,
    });

    vm.runInContext(read('server.js'), context);
    return { context, chrome };
  }

  it('fetches settings from /api/extension/settings and caches in memory for 30 seconds', async () => {
    const mockSettingsPayload = {
      geminiApiKey: 'synced-key-from-superk',
      modelHierarchy: ['gemini-3.5-flash-lite'],
      textStyle: {
        fontFamily: 'Itim, sans-serif',
        fontSizeMultiplier: 1.1,
        textColor: '#000000',
        textOutline: '#FFFFFF',
      },
      glossary: [{ original: 'Sensei', translation: 'ครู' }],
      ocrServiceUrl: 'http://127.0.0.1:8765',
    };

    const fetchMock = vi.fn().mockResolvedValue(Response.json(mockSettingsPayload));
    const { context, chrome } = createServerContext(fetchMock);

    // First call: Should perform fetch
    const settings1 = await context.SuperKServer.fetchSettings('http://127.0.0.1:3000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/api/extension/settings', expect.anything());
    expect(settings1.geminiApiKey).toBe('synced-key-from-superk');
    expect(settings1.isOfflineFallback).toBe(false);

    // Stored to chrome.storage.local for offline persistence
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        superk_cached_settings: expect.objectContaining({ geminiApiKey: 'synced-key-from-superk' }),
      })
    );

    // Second call immediately after: should return cached settings without extra fetch
    const settings2 = await context.SuperKServer.fetchSettings('http://127.0.0.1:3000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settings2.geminiApiKey).toBe('synced-key-from-superk');
  });

  it('falls back to chrome.storage.local when SuperK server is offline or returns error', async () => {
    localStorageMock['superk_cached_settings'] = {
      geminiApiKey: 'offline-cached-key',
      textStyle: { fontFamily: 'Prompt' },
    };

    const fetchMock = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const { context } = createServerContext(fetchMock);

    const settings = await context.SuperKServer.fetchSettings('http://127.0.0.1:3000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settings.geminiApiKey).toBe('offline-cached-key');
    expect(settings.isOfflineFallback).toBe(true);
  });
});
