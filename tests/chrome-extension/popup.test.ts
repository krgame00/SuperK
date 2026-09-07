import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('loads the default backend and saves a normalized URL without requiring a Gemini key', async () => {
  const html = readFileSync('chrome-extension/popup.html', 'utf8');
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1];
  const set = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { storage: { sync: { get: async (defaults: object) => defaults, set } } });
  window.eval(readFileSync('chrome-extension/server.js', 'utf8'));
  // Register exactly once, then trigger the popup's normal initialization.
  window.eval(readFileSync('chrome-extension/popup.js', 'utf8'));
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => expect((document.getElementById('serverUrl') as HTMLInputElement).value).toBe('http://127.0.0.1:3000'));
  expect((document.getElementById('apiKey') as HTMLInputElement).required).toBe(false);
  (document.getElementById('serverUrl') as HTMLInputElement).value = 'https://superk.example/';
  document.getElementById('settingsForm')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({
    translationMode: 'server', serverUrl: 'https://superk.example', apiKey: '',
  })));
  const mode = document.getElementById('translationMode') as HTMLSelectElement;
  mode.value = 'direct'; mode.dispatchEvent(new Event('change'));
  expect(document.getElementById('serverSettings')!.hidden).toBe(true);
  expect(document.getElementById('directSettings')!.hidden).toBe(false);
  expect((document.getElementById('apiKey') as HTMLInputElement).required).toBe(true);
});
