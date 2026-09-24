# SuperK Smart Desktop Launcher Specification

## 1. Overview & Problem Statement
Currently, users attempting to run SuperK Manga Translator directly from their Windows Desktop experience two points of friction:
1. **Chrome PWA App Shortcut (`SuperK Manga Translator.lnk`)**: When clicked, if the background local servers (Next.js on `:3000` and Python OCR service on `:8765`) are not running, the window cannot establish a connection (`ERR_CONNECTION_REFUSED`) and immediately closes or fails.
2. **Batch Shortcut (`start - Shortcut.lnk` targeting `start.bat`)**: When clicked, `start.bat` delegates silently to `SuperK.vbs` and invokes `exit /b 0`, resulting in a black Command Prompt window flashing for 0.1 seconds and disappearing, giving the illusion of a crash or failed startup.

## 2. Goals & Success Criteria
- **One-Click Native-Like Experience**: Double-clicking the desktop shortcut seamlessly launches SuperK in a standalone frameless app window (`--app=http://127.0.0.1:3000`).
- **Self-Healing Bootstrapping (Idempotence)**:
  - Checks if services on port `3000` and `8765` are already running.
  - If running, skips launching duplicates and immediately opens the app window.
  - If offline, launches both services silently in background, polls until health checks pass (`HTTP 200`), then opens the app window.
- **Desktop Cleanup**:
  - Updates `SuperK Manga Translator.lnk` on `C:\Users\PC\Desktop` to point directly to the smart launcher with the official SuperK application icon.
  - Safely deletes non-functional or confusing legacy shortcuts (such as `start - Shortcut.lnk`).
- **Clean Teardown Preservation**: Preserves `stop.bat` as the unified one-click mechanism to cleanly terminate all SuperK processes on ports 3000 and 8765 when finished.

## 3. Architecture & Technical Design

### A. Launcher Script (`SuperK-Launcher.vbs`)
Located at project root (`c:\Users\PC\Downloads\manga-translator\SuperK-Launcher.vbs`), executed via `wscript.exe`:
1. **Environment Setup**:
   - If drive `F:\` exists, configures cache directories (`SUPERK_CACHE_DIR`, `PADDLE_HOME`, `TORCH_HOME`, `HF_HOME`, `TEMP`).
2. **Port Probing**:
   - Uses `MSXML2.ServerXMLHTTP` or PowerShell TCP connection check to test `http://127.0.0.1:3000` and `http://127.0.0.1:8765/health`.
3. **Background Bootstrapping (if offline)**:
   - Starts Python OCR Service (`uvicorn app.api:app --host 127.0.0.1 --port 8765`) silently (`WindowStyle = 0`).
   - Starts Next.js Web App (`npm run dev`) silently (`WindowStyle = 0`).
   - Polls `http://127.0.0.1:3000` with a loop (up to 30 seconds timeout) until responding with HTTP status `< 400`.
4. **App Window Launch**:
   - Detects available Chromium-based browsers:
     1. Google Chrome (`%ProgramFiles%\Google\Chrome\Application\chrome.exe` or `%ProgramFiles(x86)%\...`)
     2. Microsoft Edge (`%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe` or `%ProgramFiles%\...`)
     3. Brave Browser (`%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe` or `%LocalAppData%\...`)
   - Executes with `--app=http://127.0.0.1:3000` to open an address-bar-free app window.
   - If no supported browser executable is found, falls back to default system browser via shell execute `http://127.0.0.1:3000`.

### B. Shortcut Generator (`scripts/setup-desktop-shortcut.mjs` / PowerShell)
- Resolves path to `SuperK-Launcher.vbs`.
- Locates application icon (`public/favicon.ico` or Chrome PWA icon).
- Writes/Overwrites `C:\Users\PC\Desktop\SuperK Manga Translator.lnk`:
  - Target: `wscript.exe`
  - Arguments: `"C:\Users\PC\Downloads\manga-translator\SuperK-Launcher.vbs"`
  - Working Directory: `"C:\Users\PC\Downloads\manga-translator"`
  - Icon: SuperK icon.
- Checks for and deletes `C:\Users\PC\Desktop\start - Shortcut.lnk`.

## 4. Verification & Testing Plan
- Test service detection when servers are already online: verify launcher opens app window in under 1 second without spawning duplicate servers.
- Test service bootstrapping when servers are completely stopped (`stop.bat` run first): verify launcher boots both services, waits for health, and opens app window without throwing errors.
- Test Desktop shortcut creation and verify file properties (Target, Arguments, Icon, WorkingDir).
- Verify clean execution of `stop.bat` still safely closes all processes.
