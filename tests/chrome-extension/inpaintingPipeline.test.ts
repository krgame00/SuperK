// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

const read = (name: string) => readFileSync(`chrome-extension/${name}`, 'utf8');

describe('SuperK Extension Inpainting Pipeline (Ticket 02)', () => {
  it('submits cleaning job, polls to completion, and returns clean image base64', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/clean/v1/jobs') && init?.method === 'POST') {
        return Response.json({ job_id: 'job-123', status: 'running' });
      }
      if (url.includes('/api/clean/v1/jobs/job-123/result')) {
        return Response.json({
          job_id: 'job-123',
          clean_asset: '/api/clean/v1/jobs/job-123/assets/clean',
        });
      }
      if (url.includes('/api/clean/v1/jobs/job-123/assets/clean')) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'Content-Type': 'image/png' },
        });
      }
      if (url.includes('/api/clean/v1/jobs/job-123')) {
        return Response.json({ job_id: 'job-123', status: 'succeeded' });
      }
      return Response.json({ error: 'Not found' }, { status: 404 });
    });

    const context = vm.createContext({
      fetch: fetchMock,
      console,
      URL,
      FormData,
      Blob,
      Uint8Array,
      btoa,
      atob,
      setTimeout,
      clearTimeout,
      AbortSignal,
      Date,
    });

    vm.runInContext(read('server.js'), context);

    const image = {
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      mimeType: 'image/png',
    };
    const settings = { serverUrl: 'http://127.0.0.1:3000' };

    const result = await context.SuperKServer.inpaintImage(image, settings);
    expect(result).toHaveProperty('cleanImageBase64');
    expect(result.jobId).toBe('job-123');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/api/clean/v1/jobs', expect.anything());
  });

  it('throws descriptive error when inpainting backend fails, strictly without fallback to white boxes', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/clean/v1/jobs') && init?.method === 'POST') {
        return Response.json({ job_id: 'job-fail', status: 'running' });
      }
      if (url.includes('/api/clean/v1/jobs/job-fail')) {
        return Response.json({ job_id: 'job-fail', status: 'failed', error: 'Inpainting model OOM' });
      }
      return Response.json({ error: 'Not found' }, { status: 404 });
    });

    const context = vm.createContext({
      fetch: fetchMock,
      console,
      URL,
      FormData,
      Blob,
      Uint8Array,
      btoa,
      atob,
      setTimeout,
      clearTimeout,
      AbortSignal,
      Date,
    });

    vm.runInContext(read('server.js'), context);

    const image = {
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      mimeType: 'image/png',
    };
    const settings = { serverUrl: 'http://127.0.0.1:3000' };

    await expect(context.SuperKServer.inpaintImage(image, settings)).rejects.toThrow('Inpainting model OOM');
  });

  it('dispatches inpainting when cleanMode is inpainting and handles RETRY_TRANSLATE', async () => {
    let onMessageListener: any;
    let contextMenuListener: any;
    const sendMessageMock = vi.fn().mockResolvedValue({});

    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url === 'https://manga.test/image.png') {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'Content-Type': 'image/png' },
        });
      }
      if (url.includes('/api/extension/settings')) {
        return Response.json({
          cleanMode: 'inpainting',
          geminiApiKey: 'test-key',
        });
      }
      if (url.includes('/api/clean/v1/jobs') && init?.method === 'POST') {
        return Response.json({ job_id: 'job-999', status: 'running' });
      }
      if (url.includes('/api/clean/v1/jobs/job-999/result')) {
        return Response.json({ clean_asset: '/clean-asset.png' });
      }
      if (url.includes('/clean-asset.png')) {
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
      }
      if (url.includes('/api/clean/v1/jobs/job-999')) {
        return Response.json({ job_id: 'job-999', status: 'succeeded' });
      }
      if (url.includes('/api/translate')) {
        return Response.json({ text: JSON.stringify({ bubbles: [{ t: 'ข้อความแปล', box: [0, 0, 100, 100] }] }) });
      }
      return Response.json({ error: 'Not found' }, { status: 404 });
    });

    const chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn((fn: any) => { onMessageListener = fn; }) },
        getPlatformInfo: vi.fn().mockResolvedValue({}),
      },
      contextMenus: {
        create: vi.fn(),
        onClicked: { addListener: vi.fn((fn: any) => { contextMenuListener = fn; }) },
      },
      tabs: { sendMessage: sendMessageMock },
      scripting: { insertCSS: vi.fn(), executeScript: vi.fn() },
      storage: {
        sync: {
          get: vi.fn(async () => ({
            translationMode: 'server',
            serverUrl: 'http://127.0.0.1:3000',
            cleanMode: 'inpainting',
          })),
        },
      },
    };

    const context = vm.createContext({
      chrome,
      fetch: fetchMock,
      console,
      URL,
      FormData,
      Blob,
      Uint8Array,
      btoa,
      atob,
      setTimeout,
      clearTimeout,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      AbortSignal,
      Date,
    });
    context.importScripts = (file: string) => vm.runInContext(read(file), context);
    vm.runInContext(read('background.js'), context);

    // Trigger translation
    await contextMenuListener({ menuItemId: 'superk-translate-image', srcUrl: 'https://manga.test/image.png' }, { id: 10 });

    expect(sendMessageMock).toHaveBeenCalledWith(10, expect.objectContaining({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: expect.any(String),
    }), expect.anything());

    // Trigger retry message
    sendMessageMock.mockClear();
    await onMessageListener({ action: 'RETRY_TRANSLATE', imageUrl: 'https://manga.test/image.png' }, { tab: { id: 10 }, frameId: 0 });

    expect(sendMessageMock).toHaveBeenCalledWith(10, expect.objectContaining({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
    }), expect.anything());
  });

  it('normalizes relative cleaner asset path /v1/... to /api/clean/v1/... and fails loud on HTTP 404', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/clean/v1/jobs') && init?.method === 'POST') {
        return Response.json({ job_id: 'job-path-norm', status: 'running' });
      }
      if (url.includes('/api/clean/v1/jobs/job-path-norm/result')) {
        return Response.json({
          job_id: 'job-path-norm',
          clean_asset: '/v1/jobs/job-path-norm/assets/clean.png',
        });
      }
      if (url === 'http://127.0.0.1:3000/api/clean/v1/jobs/job-path-norm/assets/clean.png') {
        return new Response('Not Found', { status: 404 });
      }
      if (url.includes('/api/clean/v1/jobs/job-path-norm')) {
        return Response.json({ job_id: 'job-path-norm', status: 'succeeded' });
      }
      return Response.json({ error: 'Not found' }, { status: 404 });
    });

    const context = vm.createContext({
      fetch: fetchMock,
      console,
      URL,
      FormData,
      Blob,
      Uint8Array,
      btoa,
      atob,
      setTimeout,
      clearTimeout,
      AbortSignal,
      Date,
    });

    vm.runInContext(read('server.js'), context);

    const image = {
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      mimeType: 'image/png',
    };
    const settings = { serverUrl: 'http://127.0.0.1:3000' };

    await expect(context.SuperKServer.inpaintImage(image, settings)).rejects.toThrow('HTTP 404');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/clean/v1/jobs/job-path-norm/assets/clean.png',
      expect.anything()
    );
  });

  it('bypasses inpainting entirely when translationMode is direct even if cleanMode is inpainting', async () => {
    let contextMenuListener: any;
    const sendMessageMock = vi.fn().mockResolvedValue({});
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://manga.test/direct.png') {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'Content-Type': 'image/png' },
        });
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        const text = JSON.stringify({ bubbles: [{ t: 'ตรงไปตรงมา', box: [10, 10, 50, 50] }] });
        return Response.json({
          candidates: [{ content: { parts: [{ text }] } }],
        });
      }
      return Response.json({ error: 'Unexpected route' }, { status: 500 });
    });

    const chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        getPlatformInfo: vi.fn().mockResolvedValue({}),
      },
      contextMenus: {
        create: vi.fn(),
        onClicked: { addListener: vi.fn((fn: any) => { contextMenuListener = fn; }) },
      },
      tabs: { sendMessage: sendMessageMock },
      scripting: { insertCSS: vi.fn(), executeScript: vi.fn() },
      storage: {
        sync: {
          get: vi.fn(async () => ({
            translationMode: 'direct',
            apiKey: 'test-direct-key',
            cleanMode: 'inpainting',
          })),
        },
      },
    };

    const context = vm.createContext({
      chrome,
      fetch: fetchMock,
      console,
      URL,
      FormData,
      Blob,
      Uint8Array,
      btoa,
      atob,
      setTimeout,
      clearTimeout,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      AbortSignal,
      Date,
    });
    context.importScripts = (file: string) => vm.runInContext(read(file), context);
    vm.runInContext(read('background.js'), context);

    await contextMenuListener({ menuItemId: 'superk-translate-image', srcUrl: 'https://manga.test/direct.png' }, { id: 25 });

    // Verify inpaint cleaner endpoint was NEVER called
    expect(fetchMock.mock.calls.some(call => (call[0] as string).includes('/api/clean'))).toBe(false);

    // Verify translation succeeded via direct Gemini
    expect(sendMessageMock).toHaveBeenCalledWith(25, expect.objectContaining({
      action: 'TRANSLATION_SUCCESS',
      cleanMode: 'inpainting',
      cleanImageBase64: null,
      bubbles: [{ t: 'ตรงไปตรงมา', box: [10, 10, 50, 50] }],
    }), expect.anything());
  });
});
