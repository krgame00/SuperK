# Windows Standalone Desktop Application Specification

**Triage:** `ready-for-agent`

## Problem Statement

Currently, using SuperK Manga Translator requires translators and readers to open multiple terminal consoles (one for Python FastAPI backend and one for Next.js web app) or run batch scripts, wait for both servers to bind to specific ports, and then navigate to a web browser tab.

If either terminal is closed accidentally, work can be interrupted. Running in a generic browser tab also exposes users to browser clutter (tabs, bookmarks, browser shortcuts conflicting with editor shortcuts), and non-technical team members find the multi-process setup intimidating or prone to environment misconfiguration. Users want a single, dedicated Windows desktop application with its own native window, where clicking an icon launches everything and closing the window cleans up all background processes gracefully.

## Solution

Package SuperK into a standalone Windows Desktop Application using an Electron shell that orchestrates the Next.js translation workspace and Python OCR/inpainting sidecar as managed child processes.

The desktop application provides:
1. A single executable (`SuperK.exe`) running in a dedicated, distraction-free desktop window.
2. Automatic startup and health monitoring of the Python neural cleaner sidecar and Next.js workspace server.
3. A splash screen showing initialization progress (checking models, starting cleaner service, loading workspace).
4. Full hybrid capability: local offline inpainting and OCR with cloud Gemini translation.
5. Continued loopback HTTP listening on ports `3000` and `8765` so the Chrome reading extension continues to work seamlessly with the desktop app.
6. Clean, cascading shutdown of all background services when the application window is closed.
7. Portable distribution where all neural network weights and Python runtimes are bundled without requiring administrative installation.

## User Stories

1. As a manga translator, I want to launch SuperK by double-clicking a single `SuperK.exe` icon, so that I don't have to open command prompts or run manual scripts.
2. As a manga translator, I want to see a clear startup splash screen with loading progress, so that I know when the local AI models and server are ready for use.
3. As a manga translator, I want the editor to run in its own dedicated desktop window, so that my keyboard shortcuts (e.g., Ctrl+Z, Ctrl+S, arrow keys) never conflict with browser shortcuts.
4. As a manga translator, I want the desktop window to remember its size, position, and maximized state across restarts, so that my workspace layout is preserved.
5. As a manga translator, I want the Python neural inpainting engine to run locally on my computer, so that image cleaning remains fast, private, and zero-cost.
6. As a manga translator, I want dialogue translation to continue using the Google Gemini Vision API, so that I maintain high translation quality and Thai dialogue nuance.
7. As a manga translator, I want to configure my Gemini API key, font preferences, and custom glossaries inside the desktop app settings, so that they persist reliably across sessions.
8. As a manga reader, I want the Chrome reading extension to send pages directly into the running desktop app, so that my reading-view-to-workspace workflow remains intact.
9. As a manga reader, I want the "Send back to reading view" button in the desktop app to publish translated pages back to my browser tab, so that I can inspect the final manga in context.
10. As a user on a shared or portable PC, I want to run the program from an external SSD or folder without running an administrative installer, so that I don't need Windows administrator privileges.
11. As a user, I want closing the desktop application window to automatically terminate the backend Python server and Next.js processes, so that no orphaned zombie processes consume RAM or CPU in the background.
12. As a user, I want the desktop app to detect if ports 3000 or 8765 are already in use, so that it can warn me with clear troubleshooting guidance rather than crashing silently.
13. As a user with an `F:\` cache drive, I want the desktop app to automatically route temporary neural inpainting cache files to `F:\manga-cache`, so that my system drive is not filled with temporary assets.
14. As a reviewer, I want the human review confirmation gate for uncertain pages to function identically inside the desktop application, so that quality-controlled export gating is preserved.
15. As a translator, I want to minimize the app to the Windows System Tray, so that it can stay running in the background ready for extension handoffs without cluttering my taskbar.

## Implementation Decisions

### 1. Desktop Shell Engine & Architecture
- Use Electron to create the native Windows host window.
- The Electron main process acts as the supervisor for two child processes:
  - The Python FastAPI inpainting and text detection service (`ocr-service`).
  - The Next.js workspace server running on localhost.
- The Electron renderer loads the workspace via loopback HTTP (`http://127.0.0.1:3000`), ensuring all Next.js API routes, streaming responses, and asset caching behave identically to the web build.

### 2. Sidecar Lifecycle & Process Supervision
- The Electron main process launches the Python sidecar using Node's `child_process.spawn`.
- Python sidecar execution uses the bundled virtual environment executable (`ocr-service\venv\Scripts\python.exe`).
- Process management includes a readiness watchdog: the Electron shell polls `http://127.0.0.1:8765/health` with exponential backoff before transitioning from the splash screen to the main editor window.
- Process termination binds to `app.on('before-quit')`, `app.on('window-all-closed')`, and process signal handlers (`SIGINT`, `SIGTERM`), issuing tree-kills (`taskkill /PID <pid> /T /F` on Windows) to prevent any orphaned Python or Node subprocesses.

### 3. Loopback Port Allocation & Extension Compatibility
- The application binds to fixed loopback ports: `3000` for the Next.js workspace and `8765` for the neural cleaner backend.
- A pre-flight port check verifies availability before spawning child servers. If a port collision is detected, the shell displays a user-friendly error dialog with options to terminate the conflicting process or retry.
- Maintaining standard loopback ports guarantees full, zero-code-change compatibility with the SuperK Chrome extension.

### 4. Portable Packaging & Distribution Structure
- The application distributes as a portable zip package containing:
  - `SuperK.exe` (Electron executable launcher).
  - `resources/app/` (Compiled Next.js production server and Electron main process).
  - `resources/ocr-service/` (Python virtual environment with PyTorch, PaddlePaddle, OpenCV, and pre-downloaded ONNX/PyTorch models in `models/`).
- No installer or registry modifications required.
- Dynamic cache path resolution: If drive `F:\` is present, `SUPERK_CACHE_DIR` and related AI framework homes (`TORCH_HOME`, `PADDLE_HOME`, `HF_HOME`) point to `F:\manga-cache`; otherwise, they point to local app data or portable subdirectories.

### 5. Native Window Features & Desktop Integration
- Window configuration: frameless or native title bar with custom dark theme controls, min dimensions 1024x700, default 1440x900.
- System tray icon with context menu ("Open Workspace", "Health Status", "Check for Updates", "Exit SuperK").
- Window state persistence: stores `x`, `y`, `width`, `height`, and `isMaximized` in local configuration.
- Native file drag-and-drop support matching the existing dropzone behavior.

## Testing Decisions

### Test Quality Principles
- Test external observable behavior and lifecycle states, not internal implementation mechanics.
- Prioritize process management tests: verify that child processes start, report health, and terminate cleanly upon quit signals.

### Seams to Test
1. **Child Process Lifecycle & Termination Seam**:
   - Test that the process supervisor correctly spawns the Python sidecar and Next.js server.
   - Test that graceful shutdown and abrupt window closure issue tree-kills that leave no listening ports open on 8765 or 3000.
2. **Health Polling & Startup Readiness Seam**:
   - Test that the supervisor polls `/health` endpoints and only displays the workspace window once both services report operational readiness.
   - Test timeout handling when a child service fails to initialize within the timeout budget.
3. **Port Collision Detection Seam**:
   - Test that the supervisor detects an occupied port prior to launch and surfaces a clear diagnostic error rather than crashing silently.
4. **Chrome Extension Bridge Seam**:
   - Test that publishing pages from the extension to `127.0.0.1:3000` and `127.0.0.1:8765` works as expected when servers are managed by the desktop shell.

### Prior Art
- `tests/cleaning/proxy.test.ts` (Loopback proxy routing).
- `ocr-service/tests/test_api.py` (FastAPI health endpoints).
- `scripts/package-chrome-extension.mjs` (Packaging scripts).

## Out of Scope

- Native macOS (.dmg) or Linux (.AppImage) builds (deferred to subsequent releases; Windows x64 is the initial target).
- Local LLM offline translation (translation continues to use Google Gemini Vision API for high-quality multi-language manga dialogue comprehension).
- Multi-user authentication or cloud account syncing.
- Auto-updater over the air (v1 uses portable zip package replacement).

## Further Notes

- The desktop build uses `next build` and a minimal local Node server, which can be previewed during development with `electron .` using existing dev servers.
- The `start.bat` and `stop.bat` scripts created in earlier work will remain available as fallback development and maintenance tools.
