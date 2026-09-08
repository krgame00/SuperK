# 04: Splash Screen & Startup Readiness Gate

**What to build:** When the translator double-clicks SuperK.exe, they see a branded splash screen showing labeled progress steps ("Starting cleaning engine…", "Loading workspace…", "Ready!") instead of a blank or flashing window. The main translation workspace window only becomes visible after both the Python sidecar and the Next.js server have confirmed operational readiness via health checks. If startup exceeds a timeout, the splash transitions to a clear error state with a retry option.

**Blocked by:** 02: Python Sidecar Process Supervision & Clean Shutdown

**Status:** complete

- [x] A `SplashWindow` (`BrowserWindow`) opens immediately on app launch, showing the SuperK logo and a sequence of labeled progress steps.
- [x] Progress steps update in real time as each phase completes: port check passed → Python sidecar spawned → sidecar health confirmed → Next.js server healthy → loading workspace.
- [x] The main `BrowserWindow` (translation workspace) remains hidden until all health checks pass; it then shows and the splash window closes simultaneously.
- [x] If the Python sidecar health check does not pass within 45 seconds, the splash transitions to an error state: "Cleaning engine failed to start. Check that your GPU drivers are installed." with a **[Retry]** button that re-runs the startup sequence without restarting Electron.
- [x] If the Next.js server does not respond within 30 seconds, the splash shows "Workspace server failed to start." with the same **[Retry]** option.
- [x] The splash screen respects the system's dark/light theme and renders correctly at 125% and 150% Windows display scaling.
