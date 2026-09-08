# 07: Portable Production Bundle (electron-builder)

**What to build:** A single script produces `SuperK-Windows-Portable.zip` — a self-contained folder that a translator can extract anywhere (including an external SSD) and run by double-clicking `SuperK.exe`. The bundle includes the Electron shell, the compiled Next.js production server, the Python virtual environment, and all pre-downloaded neural model weights. No administrative installer, registry writes, or internet connection are required to run the application.

**Blocked by:** 05: Native Window State Persistence & System Tray, 06: Dynamic Cache Path Routing (F:\ Drive Support)

**Status:** ready-for-agent

- [ ] `electron-builder` is configured (in `electron-builder.yml` or `package.json`) to produce a `portable` target for Windows x64 with `asar: false` so the bundled Python environment and model weights remain accessible as plain files.
- [ ] The build script (`scripts/build-desktop.mjs`) runs `next build`, then `electron-builder --win portable` and outputs `dist/SuperK-Windows-Portable.zip`.
- [ ] The portable zip contains: `SuperK.exe`, `resources/app/` (Next.js production server), `resources/ocr-service/` (Python `venv/` and pre-downloaded `models/`), and a `cache/` directory placeholder.
- [ ] Extracting the zip and double-clicking `SuperK.exe` on a clean Windows 10/11 machine (no Node.js, no Python installed system-wide) launches the splash screen, starts both services, and loads the translation workspace successfully.
- [ ] The existing `start.bat` and `stop.bat` development scripts remain functional and are not removed.
- [ ] The portable build size is documented in `README.md` (expected ~3–5 GB due to bundled PyTorch and model weights).
