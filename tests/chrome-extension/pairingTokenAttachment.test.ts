import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The background script registers its onMessage listener at import time, so
// these tests need a fresh module registry per file — that is why this lives
// in its own file rather than bidirectionalPublishing.test.ts.
describe("background.js pairing token attachment", () => {
  it("attaches the pairing token to publish-back sync and editor handoff requests", async () => {
    const messageListeners: Array<(msg: any) => void> = [];
    const storageMap = new Map<string, any>([["pairingToken", "tok-123"]]);

    (globalThis as any).chrome = {
      storage: {
        local: {
          set: vi.fn(async (obj) => {
            for (const [k, v] of Object.entries(obj)) storageMap.set(k, v);
          }),
          get: vi.fn(async (keys: any) => {
            const res: Record<string, any> = {};
            for (const k of Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys)) {
              res[k] = storageMap.get(k) ?? null;
            }
            return res;
          }),
        },
        sync: {
          get: vi.fn(async (defaults: any) => {
            const res: Record<string, any> = {};
            for (const [k, v] of Object.entries(defaults || {})) {
              res[k] = storageMap.has(k) ? storageMap.get(k) : v;
            }
            return res;
          }),
          set: vi.fn(),
        },
      },
      contextMenus: { create: vi.fn() },
      runtime: {
        sendMessage: vi.fn(),
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn((cb) => messageListeners.push(cb)) },
      },
      tabs: {
        query: vi.fn(async () => []),
        create: vi.fn(),
        sendMessage: vi.fn(),
      },
    };

    // The service worker importScripts server.js; the ESM import below does
    // not, so load it into the global scope first.
    window.eval(readFileSync("chrome-extension/server.js", "utf8"));
    // @ts-ignore - chrome extension script without module exports
    await import("../../chrome-extension/background.js");

    const fetchCalls: Array<{ url: any; init: any }> = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ epoch: "e", updates: [] }) } as any;
    });

    // Publish-back sync must carry the pairing token.
    await (globalThis as any).checkPublishedUpdates();
    const syncCall = fetchCalls.find((c) => String(c.url).includes("/api/extension/publish-back"));
    expect(syncCall?.init?.headers?.Authorization).toBe("Bearer tok-123");

    // OPEN_EDITOR handoff must carry it too.
    messageListeners[0]({ action: "OPEN_EDITOR", payload: { pageUrl: "https://m.test/p.png", sourceImage: "data:image/png;base64,YQ==", sourceRevision: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const editorCall = fetchCalls.find((c) => String(c.url).includes("/api/extension/workspace/append"));
    expect(editorCall?.init?.headers?.Authorization).toBe("Bearer tok-123");
  });
});
