# Hidden production launcher

Approved in chat: start production without a persistent console window; open the browser after the web and OCR services are ready, preserve logs and existing web shutdown.

`start-prod.bat` delegates to a hidden VBScript launcher and exits. The VBScript runs a PowerShell supervisor hidden. PowerShell checks dependencies, builds when missing, starts service executables hidden with absolute entrypoints and separate stdout/stderr logs under ignored `.superk-runtime`, waits for both health endpoints, then opens the browser. Existing verified SuperK listeners are reused; unrelated port owners are rejected. Errors produce a visible message pointing to logs. The existing development launcher remains usable.

No tray UI or manipulation of an already-open terminal is included. A brief batch bootstrap window may appear on double-click; invoking the VBScript directly avoids it. Existing windows remain until the user closes them. No actual user services are stopped or restarted during automated tests.

The supervisor exports `SUPERK_PROJECT_ROOT` for the web server so the shutdown API can find the original `stop.bat` despite standalone changing its working directory. Reused services retain their launch environment; this behavior applies when starting through the new launcher.

Verification: execute the supervisor with mocked process, health and browser functions; verify hidden service launch, logs, readiness, reuse, errors, and ownership compatibility. Parse PowerShell syntax without launching services.
