/**
 * SuperK — Dynamic Cache Path Routing (Ticket 06)
 *
 * Responsibilities:
 *  - Checks if F:\ drive is present on the host
 *  - Routes neural model directories to F:\manga-cache when F:\ exists
 *  - Otherwise defaults to <app-dir>\cache
 *  - Creates required subdirectories idempotently
 */

const fs = require("fs");
const path = require("path");

const SUBDIRECTORIES = ["ocr-jobs", "paddle", "torch", "huggingface", "temp"];

/**
 * Resolves cache environment variables and creates directories.
 * @param {object} options
 * @returns {Record<string, string>}
 */
function resolveCacheEnvironment(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const mkdirSync = options.mkdirSync || fs.mkdirSync;
  const platform = options.platform || process.platform;
  const appRoot = options.appRoot || path.resolve(__dirname, "..");

  let cacheRoot = "";
  const pathApi = platform === "win32" ? path.win32 : path;

  if (platform === "win32" && (existsSync("F:\\") || existsSync("F:/"))) {
    cacheRoot = "F:\\manga-cache";
  } else {
    cacheRoot = pathApi.join(appRoot, "cache");
  }

  // Create subdirectories using the target platform semantics, not the host
  // running the tests/build (for example Linux GitHub runners).
  for (const sub of SUBDIRECTORIES) {
    const dirPath = pathApi.join(cacheRoot, sub);
    try {
      mkdirSync(dirPath, { recursive: true });
    } catch {
      // Ignore if exists
    }
  }

  const env = {
    SUPERK_CACHE_ROOT: cacheRoot,
    TORCH_HOME: pathApi.join(cacheRoot, "torch"),
    PADDLE_HOME: pathApi.join(cacheRoot, "paddle"),
    HF_HOME: pathApi.join(cacheRoot, "huggingface"),
    TEMP: pathApi.join(cacheRoot, "temp"),
    TMP: pathApi.join(cacheRoot, "temp"),
  };

  return env;
}

module.exports = {
  resolveCacheEnvironment,
  SUBDIRECTORIES,
};
