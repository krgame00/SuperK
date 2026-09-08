/**
 * Tests for Dynamic Cache Path Routing
 * Ticket 06: Dynamic Cache Path Routing (F:\ Drive Support)
 *
 * Observable external behavior tested:
 *  - Detects if F:\ drive is available on the host machine
 *  - Routes cache directories to F:\manga-cache when F:\ is present:
 *      - SUPERK_CACHE_DIR -> F:\manga-cache
 *      - TORCH_HOME -> F:\manga-cache\torch
 *      - PADDLE_HOME -> F:\manga-cache\paddle
 *      - HF_HOME -> F:\manga-cache\huggingface
 *      - TEMP -> F:\manga-cache\temp
 *  - Fallbacks to <app-dir>\cache when F:\ is absent
 *  - Creates required subdirectories idempotently
 */

import { describe, it, expect, vi } from "vitest";
import path from "path";
import { resolveCacheEnvironment } from "../../electron/cacheRouting";

describe("Cache Routing (Ticket 06)", () => {
  it("routes all cache environment variables to F:\\manga-cache when F:\\ is present", () => {
    const mockExistsSync = vi.fn((p: string) => {
      if (p === "F:\\" || p === "F:/") return true;
      return false;
    });
    const mockMkdirSync = vi.fn();

    const env = resolveCacheEnvironment({
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
      platform: "win32",
      appRoot: "C:\\SuperK",
    });

    expect(env.SUPERK_CACHE_ROOT).toBe("F:\\manga-cache");
    expect(env.TORCH_HOME).toBe("F:\\manga-cache\\torch");
    expect(env.PADDLE_HOME).toBe("F:\\manga-cache\\paddle");
    expect(env.HF_HOME).toBe("F:\\manga-cache\\huggingface");
    expect(env.TEMP).toBe("F:\\manga-cache\\temp");
    expect(env.TMP).toBe("F:\\manga-cache\\temp");

    // Subdirectories should be created
    expect(mockMkdirSync).toHaveBeenCalledWith(
      "F:\\manga-cache\\torch",
      expect.objectContaining({ recursive: true })
    );
    expect(mockMkdirSync).toHaveBeenCalledWith(
      "F:\\manga-cache\\ocr-jobs",
      expect.objectContaining({ recursive: true })
    );
  });

  it("fallbacks to local app directory cache when F:\\ is absent", () => {
    const mockExistsSync = vi.fn().mockReturnValue(false);
    const mockMkdirSync = vi.fn();

    const appRoot = "C:\\SuperK";
    const expectedRoot = path.join(appRoot, "cache");

    const env = resolveCacheEnvironment({
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
      platform: "win32",
      appRoot,
    });

    expect(env.SUPERK_CACHE_ROOT).toBe(expectedRoot);
    expect(env.TORCH_HOME).toBe(path.join(expectedRoot, "torch"));
    expect(env.PADDLE_HOME).toBe(path.join(expectedRoot, "paddle"));
    expect(env.HF_HOME).toBe(path.join(expectedRoot, "huggingface"));
    expect(env.TEMP).toBe(path.join(expectedRoot, "temp"));

    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.join(expectedRoot, "torch"),
      expect.objectContaining({ recursive: true })
    );
  });
});
