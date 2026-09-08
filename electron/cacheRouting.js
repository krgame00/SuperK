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

  if (platform === "win32" && (existsSync("F:\\") || existsSync("F:/"))) {
    cacheRoot = "F:\\manga-cache";
  } else {
    cacheRoot = path.join(appRoot, "cache");
  }

  // Create subdirectories
  for (const sub of SUBDIRECTORIES) {
    const dirPath = path.join(cacheRoot, sub);
    try {
      mkdirSync(dirPath, { recursive: true });
    } catch {
      // Ignore if exists
    }
  }

  const env = {
    SUPERK_CACHE_ROOT: cacheRoot,
    TORCH_HOME: path.join(cacheRoot, "torch"),
    PADDLE_HOME: path.join(cacheRoot, "paddle"),
    HF_HOME: path.join(cacheRoot, "huggingface"),
    TEMP: path.join(cacheRoot, "temp"),
    TMP: path.join(cacheRoot, "temp"),
  };

  return env;
}

module.exports = {
  resolveCacheEnvironment,
  SUBDIRECTORIES,
};
