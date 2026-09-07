import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Bidirectional Publishing Integration (Ticket 05)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("updates DOM overlay and local storage when receiving published translation", async () => {
    // 1. Setup mock DOM with target manga image
    const imgUrl = "https://manga.example.com/ch1/p10.jpg";
    const img = document.createElement("img");
    img.src = imgUrl;
    img.width = 800;
    img.height = 1200;
    document.body.appendChild(img);

    // Mock chrome APIs
    const storageMap = new Map<string, any>();
    const messageListeners: Array<(msg: any, sender?: any, sendResponse?: any) => void> = [];

    (globalThis as any).chrome = {
      storage: {
        local: {
          set: vi.fn(async (obj) => {
            for (const [k, v] of Object.entries(obj)) {
              storageMap.set(k, v);
            }
          }),
          get: vi.fn(async (key) => ({ [key]: storageMap.get(key) })),
        },
        sync: {
          get: vi.fn(async () => ({ serverUrl: "http://127.0.0.1:3000" })),
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
          for (const listener of messageListeners) {
            listener(msg);
          }
        }),
      },
    };

    // Load content script
    delete (globalThis as any).__superKLoaded;
    // @ts-ignore - chrome extension script without module exports
    await import("../../chrome-extension/content.js");

    // Load background script
    // @ts-ignore - chrome extension script without module exports
    await import("../../chrome-extension/background.js");

    // Mock fetch for /api/extension/publish-back
    const publishedPayload = {
      updates: [
        {
          pageUrl: imgUrl,
          originUrl: "https://manga.example.com/ch1",
          bubbles: [
            {
              t: "คำแปลที่แก้ไขอย่างประณีตใน SuperK Editor",
              box: [150, 150, 350, 450],
            },
          ],
          cleanUrl: null,
          textStyle: {
            fontFamily: "Itim, sans-serif",
            fontSizeMultiplier: 1.1,
            textColor: "#111111",
            textOutline: "#EEEEEE",
          },
          updatedAt: Date.now(),
        },
      ],
    };

    globalThis.fetch = vi.fn(async (url: any) => {
      if (typeof url === "string" && url.includes("/api/extension/publish-back")) {
        return {
          ok: true,
          status: 200,
          json: async () => publishedPayload,
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    // 2. Trigger checkPublishedUpdates from background
    const updates = await (globalThis as any).checkPublishedUpdates();
    expect(updates.length).toBe(1);

    // 3. Verify storage cache was updated
    expect(storageMap.has(`superk_trans_${imgUrl}`)).toBe(true);
    const cached = storageMap.get(`superk_trans_${imgUrl}`);
    expect(cached.bubbles[0].t).toBe("คำแปลที่แก้ไขอย่างประณีตใน SuperK Editor");

    // 4. Verify DOM overlay was updated with the published text
    const overlay = document.querySelector(".superk-overlay-container");
    expect(overlay).not.toBeNull();
    const bubbleEl = overlay?.querySelector(".superk-text-bubble");
    expect(bubbleEl).not.toBeNull();
    expect(bubbleEl?.textContent?.replace(/\s+/g, "")).toContain("คำแปลที่แก้ไขอย่างประณีตในSuperKEditor");
  });
});
