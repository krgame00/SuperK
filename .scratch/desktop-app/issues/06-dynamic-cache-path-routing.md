# 06: Dynamic Cache Path Routing (F:\ Drive Support)

**What to build:** When the desktop application starts the Python sidecar, it automatically detects whether an `F:\` drive is present on the machine and, if so, routes all neural model cache directories (`SUPERK_CACHE_DIR`, `TORCH_HOME`, `PADDLE_HOME`, `HF_HOME`, `TEMP`) to `F:\manga-cache`. If `F:\` is not present, the sidecar uses a `cache/` subdirectory inside the portable application folder. The translator never has to configure paths manually.

**Blocked by:** 02: Python Sidecar Process Supervision & Clean Shutdown

**Status:** complete

- [x] Before spawning the Python sidecar, the main process checks whether `F:\` is accessible using `fs.existsSync('F:\\')`.
- [x] If `F:\` is present: creates subdirectories `F:\manga-cache\ocr-jobs`, `F:\manga-cache\paddle`, `F:\manga-cache\torch`, `F:\manga-cache\huggingface`, `F:\manga-cache\temp` if they don't exist, then sets environment variables on the sidecar spawn accordingly.
- [x] If `F:\` is absent: all cache dirs default to `<app-dir>\cache\ocr-jobs`, `<app-dir>\cache\torch`, etc., created on first launch.
- [x] The active cache root is logged at startup and visible in the Electron DevTools console.
- [x] An automated unit test for the cache-path resolver mocks `fs.existsSync` for both the F-drive-present and F-drive-absent cases, and asserts the correct environment variable map is returned in each case.
