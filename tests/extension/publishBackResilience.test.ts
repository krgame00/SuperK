import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Publish-Back Sync Resiliency & Epoch Recovery (Ticket PR-2)", () => {
  let storageMap: Map<string, any>;
  let messageListeners: Array<(msg: any) => void>;

  beforeEach(async () => {
    storageMap = new Map();
    messageListeners = [];
    vi.restoreAllMocks();

    (globalThis as any).chrome = {
      storage: {
        local: {
          set: vi.fn(async (obj) => {
            for (const [k, v] of Object.entries(obj)) {
              storageMap.set(k, v);
            }
          }),
          get: vi.fn(async (keys) => {
            if (typeof keys === "string") {
              return { [keys]: storageMap.get(keys) };
            }
            if (Array.isArray(keys)) {
              const res: Record<string, any> = {};
              for (const k of keys) res[k] = storageMap.get(k);
              return res;
            }
            if (typeof keys === "object" && keys !== null) {
              const res: Record<string, any> = {};
              for (const [k, defVal] of Object.entries(keys)) {
                res[k] = storageMap.has(k) ? storageMap.get(k) : defVal;
              }
              return res;
            }
            return {};
          }),
        },
        sync: {
          get: vi.fn(async (defaults) => {
            const res: Record<string, any> = {};
            for (const [k, defVal] of Object.entries(defaults || {})) {
              res[k] = storageMap.has(k) ? storageMap.get(k) : defVal;
            }
            return res;
          }),
          set: vi.fn(async (obj) => {
            for (const [k, v] of Object.entries(obj)) {
              storageMap.set(k, v);
            }
          }),
        },
      },
      contextMenus: {
        create: vi.fn(),
      },
      runtime: {
        sendMessage: vi.fn(),
        onInstalled: {
          addListener: vi.fn(),
        },
        onMessage: {
          addListener: vi.fn((cb) => messageListeners.push(cb)),
        },
      },
      tabs: {
        query: vi.fn(async () => [{ id: 101 }]),
        sendMessage: vi.fn(async (_tabId, msg) => {
          for (const l of messageListeners) l(msg);
        }),
      },
    };

    // Load background.js
    // @ts-ignore - chrome extension script without module exports
    await import("../../chrome-extension/background.js");
  });

  it("normalizes server URLs with trailing slashes and spaces", () => {
    const normalize = (globalThis as any).normalizeServerUrl;
    expect(normalize("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
    expect(normalize("  http://localhost:3000/// ")).toBe("http://localhost:3000");
    expect(normalize("http://127.0.0.1:8765/subpath/")).toBe("http://127.0.0.1:8765/subpath");
  });

  it("retains independent cursors when switching A -> B -> A without losing or repeating updates", async () => {
    const checkUpdates = (globalThis as any).checkPublishedUpdates;
    const serverA = "http://server-a.local:3000";
    const serverB = "http://server-b.local:3000";

    // Step 1: Connect to Server A with 2 updates
    storageMap.set("serverUrl", serverA);
    const mockFetchA1 = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        epoch: "epoch_A",
        updates: [
          { seq: 1, pageUrl: "https://example.com/p1.png", bubbles: [{ t: "A1" }], updatedAt: 100 },
          { seq: 2, pageUrl: "https://example.com/p2.png", bubbles: [{ t: "A2" }], updatedAt: 200 },
        ],
      }),
    });
    globalThis.fetch = mockFetchA1;

    const resA1 = await checkUpdates();
    expect(resA1.length).toBe(2);
    expect(storageMap.get("superk_trans_https://example.com/p1.png")?.bubbles[0].t).toBe("A1");

    // Check cursor A in storage
    const cursorAKey = `superk_sync_cursor_${encodeURIComponent(serverA)}`;
    const cursorA = storageMap.get(cursorAKey);
    expect(cursorA).toBeDefined();
    expect(cursorA.seq).toBe(2);
    expect(cursorA.epoch).toBe("epoch_A");

    // Step 2: Switch to Server B
    storageMap.set("serverUrl", serverB);
    const mockFetchB = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        epoch: "epoch_B",
        updates: [
          { seq: 1, pageUrl: "https://example.com/b1.png", bubbles: [{ t: "B1" }], updatedAt: 300 },
        ],
      }),
    });
    globalThis.fetch = mockFetchB;

    const resB = await checkUpdates();
    expect(resB.length).toBe(1);
    expect(storageMap.get("superk_trans_https://example.com/b1.png")?.bubbles[0].t).toBe("B1");

    const cursorBKey = `superk_sync_cursor_${encodeURIComponent(serverB)}`;
    const cursorB = storageMap.get(cursorBKey);
    expect(cursorB.seq).toBe(1);
    expect(cursorB.epoch).toBe("epoch_B");

    // Step 3: Switch back to Server A (A -> B -> A)
    // Server A receives request with sinceSeq=2 and returns seq 3
    storageMap.set("serverUrl", serverA);
    const mockFetchA2 = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("sinceSeq=2");
      expect(url).toContain("sinceEpoch=epoch_A");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          epoch: "epoch_A",
          updates: [
            { seq: 3, pageUrl: "https://example.com/p3.png", bubbles: [{ t: "A3" }], updatedAt: 400 },
          ],
        }),
      };
    });
    globalThis.fetch = mockFetchA2;

    const resA2 = await checkUpdates();
    expect(resA2.length).toBe(1);
    expect(resA2[0].seq).toBe(3);
    expect(storageMap.get("superk_trans_https://example.com/p3.png")?.bubbles[0].t).toBe("A3");
    expect(storageMap.get(cursorAKey).seq).toBe(3);
  });

  it("resets cursor to 0 and re-syncs when server epoch changes (server restart)", async () => {
    const checkUpdates = (globalThis as any).checkPublishedUpdates;
    const serverUrl = "http://127.0.0.1:3000";
    storageMap.set("serverUrl", serverUrl);

    // Initial sync on epoch 1
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        epoch: "epoch_run_1",
        updates: [
          { seq: 5, pageUrl: "https://example.com/page-x.png", bubbles: [{ t: "Old Epoch" }], updatedAt: 100 },
        ],
      }),
    });

    await checkUpdates();
    const cursorKey = `superk_sync_cursor_${encodeURIComponent(serverUrl)}`;
    expect(storageMap.get(cursorKey).epoch).toBe("epoch_run_1");
    expect(storageMap.get(cursorKey).seq).toBe(5);

    // Server restarts: epoch changes to epoch_run_2, sequences reset to 1
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        epoch: "epoch_run_2",
        epochChanged: true,
        updates: [
          { seq: 1, pageUrl: "https://example.com/page-restarted.png", bubbles: [{ t: "Restarted Server Item" }], updatedAt: 200 },
        ],
      }),
    });

    const resAfterRestart = await checkUpdates();
    expect(resAfterRestart.length).toBe(1);
    expect(resAfterRestart[0].pageUrl).toBe("https://example.com/page-restarted.png");

    const updatedCursor = storageMap.get(cursorKey);
    expect(updatedCursor.epoch).toBe("epoch_run_2");
    expect(updatedCursor.seq).toBe(1);
  });

  it("restores cursor from chrome.storage.local across extension restarts", async () => {
    const checkUpdates = (globalThis as any).checkPublishedUpdates;
    const serverUrl = "http://127.0.0.1:3000";
    storageMap.set("serverUrl", serverUrl);

    // Seed storage with persisted cursor (as if from prior extension session)
    const cursorKey = `superk_sync_cursor_${encodeURIComponent(serverUrl)}`;
    storageMap.set(cursorKey, {
      serverUrl,
      epoch: "epoch_persisted",
      seq: 10,
      lastSyncTime: 99999,
    });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("sinceSeq=10");
      expect(url).toContain("sinceEpoch=epoch_persisted");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          epoch: "epoch_persisted",
          updates: [
            { seq: 11, pageUrl: "https://example.com/p11.png", bubbles: [{ t: "P11" }], updatedAt: 100000 },
          ],
        }),
      };
    });

    const updates = await checkUpdates();
    expect(updates.length).toBe(1);
    expect(updates[0].seq).toBe(11);
    expect(storageMap.get(cursorKey).seq).toBe(11);
  });

  it("handles out-of-order and duplicate publications cleanly without regression", async () => {
    const checkUpdates = (globalThis as any).checkPublishedUpdates;
    const serverUrl = "http://127.0.0.1:3000";
    storageMap.set("serverUrl", serverUrl);

    // Initial state: cursor is seq 2
    const cursorKey = `superk_sync_cursor_${encodeURIComponent(serverUrl)}`;
    storageMap.set(cursorKey, {
      serverUrl,
      epoch: "epoch_order",
      seq: 2,
      lastSyncTime: 200,
    });

    // Server returns unordered items including a duplicate of seq 2
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        epoch: "epoch_order",
        updates: [
          { seq: 4, pageUrl: "https://example.com/p4.png", bubbles: [{ t: "Four" }], updatedAt: 400 },
          { seq: 2, pageUrl: "https://example.com/p2.png", bubbles: [{ t: "Two Dupe" }], updatedAt: 200 },
          { seq: 3, pageUrl: "https://example.com/p3.png", bubbles: [{ t: "Three" }], updatedAt: 300 },
        ],
      }),
    });

    const res = await checkUpdates();
    // Seq 2 is skipped (seq <= cursor.seq). Seq 3 and Seq 4 are processed in order.
    expect(res.map((u: any) => u.seq)).toEqual([3, 4]);
    expect(storageMap.get(cursorKey).seq).toBe(4);
  });

  it("does not advance cursor past an item if storage or dispatch fails", async () => {
    const checkUpdates = (globalThis as any).checkPublishedUpdates;
    const serverUrl = "http://127.0.0.1:3000";
    storageMap.set("serverUrl", serverUrl);

    const cursorKey = `superk_sync_cursor_${encodeURIComponent(serverUrl)}`;
    storageMap.set(cursorKey, {
      serverUrl,
      epoch: "epoch_err",
      seq: 0,
      lastSyncTime: 0,
    });

    // Make chrome.storage.local.set fail when saving p2
    const originalSet = (globalThis as any).chrome.storage.local.set;
    (globalThis as any).chrome.storage.local.set = vi.fn(async (obj) => {
      if (obj["superk_trans_https://example.com/fail.png"]) {
        throw new Error("Disk Full / Storage Quota Exceeded");
      }
      return originalSet(obj);
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        epoch: "epoch_err",
        updates: [
          { seq: 1, pageUrl: "https://example.com/ok.png", bubbles: [{ t: "OK" }], updatedAt: 100 },
          { seq: 2, pageUrl: "https://example.com/fail.png", bubbles: [{ t: "FAIL" }], updatedAt: 200 },
          { seq: 3, pageUrl: "https://example.com/after.png", bubbles: [{ t: "AFTER" }], updatedAt: 300 },
        ],
      }),
    });

    const res = await checkUpdates();
    // Only item 1 was processed before error stopped the loop
    expect(res.map((u: any) => u.seq)).toEqual([1]);
    // Cursor MUST remain at 1, NOT 2 or 3!
    expect(storageMap.get(cursorKey).seq).toBe(1);
  });
});
