# 02: Python Sidecar Process Supervision & Clean Shutdown

**What to build:** When the desktop application launches, it automatically starts the Python inpainting and OCR sidecar as a managed child process — no terminal window required. The Electron main process owns the sidecar's full lifecycle: it spawns it on startup, monitors its health via the `/health` endpoint, and terminates it with a Windows tree-kill when the application window closes, leaving no zombie Python processes behind.

**Blocked by:** 01: Electron Shell Bootstrap & Dev Launch

**Status:** ready-for-agent

- [ ] The Electron main process spawns `ocr-service\venv\Scripts\python.exe -m uvicorn app.api:app --host 127.0.0.1 --port 8765` as a hidden child process from the `ocr-service/` directory on application startup.
- [ ] The sidecar's stdout and stderr are piped to the Electron main process log (visible in DevTools console), not in a separate terminal window.
- [ ] The main process polls `http://127.0.0.1:8765/health` with exponential backoff (starting at 500 ms, max 30 s total) and resolves a promise when the sidecar reports healthy.
- [ ] On `app.before-quit` and `window-all-closed`, the main process issues `taskkill /PID <pid> /T /F` to tree-kill the Python sidecar and confirms the process is no longer running before the Electron process exits.
- [ ] If the sidecar process exits unexpectedly during a session, the main window displays a non-blocking toast notification informing the translator that the cleaning service has stopped.
- [ ] An automated unit test for the sidecar supervisor module mocks `child_process.spawn`, `fetch` (for health polling), and `taskkill`, and verifies: spawn on init → health poll resolves → tree-kill on quit.
