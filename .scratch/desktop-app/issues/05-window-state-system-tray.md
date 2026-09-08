# 05: Native Window State Persistence & System Tray

**What to build:** The desktop application window remembers its size, position, and maximized state across restarts, so translators never have to resize or reposition it after rebooting. Closing the window minimizes the application to the Windows System Tray instead of quitting, keeping the sidecar alive and ready to receive pages from the Chrome extension. A tray context menu gives access to "Open Workspace", "Check Service Health", and "Exit SuperK".

**Blocked by:** 04: Splash Screen & Startup Readiness Gate

**Status:** ready-for-agent

- [ ] On first launch, the main window opens at 1440×900 centered on the primary monitor. On subsequent launches it restores the last `x`, `y`, `width`, `height`, and `isMaximized` values from persisted local configuration.
- [ ] Window state is written to local config within 500 ms of the window being moved, resized, or maximized (debounced), not only on quit.
- [ ] Clicking the window's close button minimizes to the Windows System Tray icon rather than quitting the application; all child processes (Python sidecar, Next.js) remain running.
- [ ] A System Tray icon is present with a right-click context menu containing: **Open Workspace** (shows and focuses the main window), **Service Health** (opens `http://127.0.0.1:8765/health` in the default browser), and **Exit SuperK** (triggers clean shutdown of all child processes before quitting).
- [ ] Double-clicking the System Tray icon shows and focuses the main window.
- [ ] The tray icon badge or tooltip shows "SuperK — Running" when both services are healthy and "SuperK — Service Error" if the Python sidecar exits unexpectedly.
