// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/server/geminiCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/geminiCatalog")>();
  return {
    ...actual,
    geminiCatalogManager: {
      getCatalog: vi.fn(),
      getRouteCooldownUntil: vi.fn(),
      getModelHealth: vi.fn(),
    },
  };
});

import { geminiCatalogManager } from "@/lib/server/geminiCatalog";
import { POST } from "@/src/app/api/translate/models/route";

const manager = geminiCatalogManager as unknown as {
  getCatalog: ReturnType<typeof vi.fn>;
  getRouteCooldownUntil: ReturnType<typeof vi.fn>;
  getModelHealth: ReturnType<typeof vi.fn>;
};

describe("POST /api/translate/models", () => {
  beforeEach(() => {
    manager.getCatalog.mockReset();
    manager.getRouteCooldownUntil.mockReset();
    manager.getModelHealth.mockReset();
    manager.getModelHealth.mockImplementation((_catalog: unknown, model: string) =>
      model === "gemini-stable"
        ? {
            status: "partial_quota",
            cooldownKeys: 1,
            nextRetryAt: 999,
            recoveryInFlight: false,
          }
        : {
            status: "ready",
            cooldownKeys: 0,
            recoveryInFlight: false,
          },
    );
    process.env.GEMINI_API_KEY = "server-secret";
    manager.getCatalog.mockResolvedValue({
      pool: {
        id: "user-pool-safe",
        owner: "user",
        keys: [
          { id: "key-safe-a", slot: 1, owner: "user", apiKey: "user-secret-a" },
          { id: "key-safe-b", slot: 2, owner: "server", apiKey: "user-secret-b" },
        ],
      },
      snapshot: {
        poolId: "user-pool-safe",
        owner: "user",
        source: "live",
        stale: false,
        discoveredAt: 100,
        expiresAt: 200,
        keys: [
          { id: "key-safe-a", slot: 1, owner: "user", valid: true, modelCount: 2 },
          { id: "key-safe-b", slot: 2, owner: "server", valid: true, modelCount: 1 },
        ],
        models: [
          {
            id: "gemini-stable",
            displayName: "Gemini Stable",
            description: "Stable text and image model",
            releaseChannel: "stable",
            supportedGenerationMethods: ["generateContent"],
            keyIds: ["key-safe-a", "key-safe-b"],
            availabilityCount: 2,
            totalKeys: 2,
            compatibility: { text: "compatible", image: "unverified" },
          },
          {
            id: "gemini-preview-x",
            displayName: "Gemini Preview X",
            releaseChannel: "preview",
            supportedGenerationMethods: ["generateContent"],
            keyIds: ["key-safe-a"],
            availabilityCount: 1,
            totalKeys: 2,
            compatibility: { text: "unverified", image: "unverified" },
          },
        ],
      },
    });
    manager.getRouteCooldownUntil.mockImplementation((poolId: string, model: string, keyId: string) =>
      model === "gemini-stable" && keyId === "key-safe-a" ? 999 : undefined,
    );
  });

  test("returns a sanitized dynamic catalog with availability, compatibility, Preview and cooldown state", async () => {
    const response = await POST(new Request("http://localhost/api/translate/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "user-secret-a,user-secret-b", force: true }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(manager.getCatalog).toHaveBeenCalledWith({
      userApiKeyRaw: "user-secret-a,user-secret-b",
      serverApiKeyRaw: "server-secret",
      force: true,
    });
    expect(body).toMatchObject({
      owner: "user",
      source: "live",
      stale: false,
      totalKeys: 2,
      maxKeys: 10,
      validKeys: 2,
      keys: [
        expect.objectContaining({ slot: 1, owner: "user", valid: true }),
        expect.objectContaining({ slot: 2, owner: "server", valid: true }),
      ],
      models: [
        expect.objectContaining({
          id: "gemini-stable",
          releaseChannel: "stable",
          availabilityCount: 2,
          totalKeys: 2,
          cooldownKeys: 1,
          status: "partial_quota",
          nextRetryAt: 999,
          compatibility: { text: "compatible", image: "unverified" },
        }),
        expect.objectContaining({
          id: "gemini-preview-x",
          releaseChannel: "preview",
          availabilityCount: 1,
        }),
      ],
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("user-secret-a");
    expect(serialized).not.toContain("user-secret-b");
    expect(serialized).not.toContain("server-secret");
    expect(serialized).not.toContain("key-safe-a");
  });
});
