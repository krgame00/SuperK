# 0003. Windows Desktop Application Architecture

Date: 2026-09-08

## Status

Accepted

## Context

SuperK Manga Translator currently operates as a dual-process system: a Python FastAPI service (`ocr-service`) running on port `8765` for neural text detection and inpainting, and a Next.js web application running on port `3000`. Users launch these via command-line terminals or batch scripts and interact through a browser tab.

Translators and readers requested a single native desktop application (`.exe`) on Windows with its own standalone window, eliminating the need to manage terminal consoles, keep browser tabs open, or configure environments manually.

## Decision

1. **Target Platform**:
   Target Windows 10/11 (x64) as the primary deployment platform.

2. **Shell Engine (Electron with Embedded Sidecars)**:
   Adopt Electron to encapsulate the Next.js workspace into a dedicated desktop window. The Electron main process orchestrates the entire application lifecycle:
   - Spawns the Python `ocr-service` as a background sidecar child process.
   - Spawns/serves the Next.js application layer.
   - Displays a native desktop application window with custom menu and system tray controls.
   - Gracefully terminates all child processes upon window close.

3. **Hybrid Processing Model**:
   Maintain the hybrid workload architecture:
   - **Local AI Execution (Offline)**: Neural text detection (PaddleOCR, Manga-Text-Detector) and inpainting (LaMa, AOT, Flat cleaners) execute entirely on the local machine (GPU/CPU) via the Python sidecar.
   - **Cloud Translation (Online)**: Dialogue comprehension and multi-language translation query the Google Gemini Vision API over HTTPS, requiring an internet connection and user API key.

4. **Distribution Format (Portable All-In-One Bundle)**:
   Package the application as a standalone portable bundle (`SuperK-Windows-Portable.zip`) containing `SuperK.exe`, the bundled Electron shell, the Next.js runtime, the embedded Python virtual environment, and pre-packaged neural network weights (`models/`). Users can extract and run immediately without administrative installation or first-run model downloads, and can run directly from external drives (e.g., `F:\manga-cache`).

5. **Browser Extension Interoperability**:
   The desktop application retains loopback HTTP listeners on `127.0.0.1:3000` and `127.0.0.1:8765`. The SuperK Chrome reading extension continues to communicate seamlessly with the desktop app without requiring any protocol changes.

## Consequences

- **Positive**: Single double-click execution; no terminal windows or environment setup required; unified window management; clean process termination prevents zombie servers; seamless Chrome extension compatibility preserved.
- **Trade-offs**: Portable download size is ~3-5 GB due to embedded PyTorch, PaddlePaddle, and model weights; Electron introduces ~150-250 MB RAM baseline overhead.
