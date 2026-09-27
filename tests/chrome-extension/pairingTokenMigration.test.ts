// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const read = (name: string) => readFileSync(`chrome-extension/${name}`, 'utf8');

describe('pairing token sync→local migration', () => {
  function createContext({
    syncData = {},
    localData = {},
    withoutSync = false,
  }: {
    syncData?: Record<string, unknown>;
    localData?: Record<string, unknown>;
    withoutSync?: boolean;
  }) {
    const syncCalls = { set: [] as unknown[], remove: [] as unknown[] };
    const localCalls = { set: [] as unknown[], remove: [] as unknown[] };
    const storage: Record<string, unknown> = {
      local: {
        get: vi.fn(async (defaults: Record<string, unknown>) => ({ ...defaults, ...localData })),
        set: vi.fn(async (items: Record<string, unknown>) => { localCalls.set.push(items); }),
        remove: vi.fn(async (key: string) => { localCalls.remove.push(key); }),
      },
    };
    if (!withoutSync) {
      storage.sync = {
        get: vi.fn(async (defaults: Record<string, unknown>) => ({ ...defaults, ...syncData })),
        set: vi.fn(async (items: Record<string, unknown>) => { syncCalls.set.push(items); }),
        remove: vi.fn(async (key: string) => { syncCalls.remove.push(key); }),
      };
    }
    const chrome = { storage };
    const context = vm.createContext({ chrome, console, URL, Date });
    vm.runInContext(read('server.js'), context);
    return { context, syncCalls, localCalls };
  }

  it('migrates a token found in sync into local and scrubs sync', async () => {
    const { context, syncCalls, localCalls } = createContext({
      syncData: { pairingToken: 'tok-sync' },
    });
    const settings = await (
      context as unknown as { loadExtensionSettings: (d: object) => Promise<{ pairingToken: string }> }
    ).loadExtensionSettings({ pairingToken: '', serverUrl: 'http://127.0.0.1:3000' });
    expect(settings.pairingToken).toBe('tok-sync');
    expect(localCalls.set).toEqual([{ pairingToken: 'tok-sync' }]);
    expect(syncCalls.remove).toEqual(['pairingToken']);
  });

  it('prefers the local token and leaves sync alone once migrated', async () => {
    const { context, syncCalls, localCalls } = createContext({
      syncData: { pairingToken: 'tok-sync' },
      localData: { pairingToken: 'tok-local' },
    });
    const settings = await (
      context as unknown as { loadExtensionSettings: (d: object) => Promise<{ pairingToken: string }> }
    ).loadExtensionSettings({ pairingToken: '' });
    expect(settings.pairingToken).toBe('tok-local');
    expect(localCalls.set).toEqual([]);
    expect(syncCalls.remove).toEqual([]);
  });

  it('keeps working when sync storage is unavailable', async () => {
    const { context, localCalls } = createContext({ localData: { pairingToken: 'tok-local' }, withoutSync: true });
    const settings = await (
      context as unknown as { loadExtensionSettings: (d: object) => Promise<{ pairingToken: string }> }
    ).loadExtensionSettings({ pairingToken: '' });
    expect(settings.pairingToken).toBe('tok-local');
    expect(localCalls.set).toEqual([]);
    expect(localCalls.remove).toEqual([]);
  });
});
