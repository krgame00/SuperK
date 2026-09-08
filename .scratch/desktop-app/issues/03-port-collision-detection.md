# 03: Pre-flight Port Collision Detection & User Guidance

**What to build:** Before the desktop application spawns any child process, it checks whether ports 3000 and 8765 are already in use on the loopback interface. If either port is occupied, the application presents a clear native dialog explaining which port is blocked, what is likely holding it, and offering two actions: "Kill conflicting process and retry" or "Exit". The app never silently crashes or proceeds when a port is unavailable.

**Blocked by:** 01: Electron Shell Bootstrap & Dev Launch

**Status:** ready-for-agent

- [ ] On startup, before spawning child processes, the main process attempts to bind a temporary TCP listener on `127.0.0.1:3000` and `127.0.0.1:8765` to detect occupancy.
- [ ] If port 3000 is occupied, a native `dialog.showMessageBox` appears: "Port 3000 is already in use. Another instance of SuperK or a Next.js server may be running. Kill it and retry, or exit." with buttons **[Kill & Retry]** and **[Exit]**.
- [ ] If port 8765 is occupied, the same pattern applies, identifying port 8765 as the neural cleaner service port.
- [ ] Selecting "Kill & Retry" issues a tree-kill on the process occupying the port (using PowerShell `Get-NetTCPConnection` → `Stop-Process` on Windows), then re-runs the pre-flight check before proceeding.
- [ ] Selecting "Exit" calls `app.quit()` cleanly.
- [ ] An automated unit test for the port-check module mocks net socket binding, verifies that a collision is detected, and checks that the correct dialog message is surfaced.
