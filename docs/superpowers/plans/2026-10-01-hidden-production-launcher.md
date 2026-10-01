# Hidden Production Launcher Implementation Plan

**Goal:** Implement the approved hidden production launch behavior.

**Architecture:** Batch bootstrap -> hidden VBScript -> PowerShell supervisor -> hidden Node/uvicorn services. Keep existing ownership shutdown compatible through absolute entrypoints.

- [x] Add failing behavior tests for hidden launch, readiness, logging, listener reuse and failure paths, using mocked system calls.
- [x] Add hidden VBScript and PowerShell supervisor; replace interactive production batch menu with bootstrap.
- [x] Verify behavior tests and existing launcher/shutdown tests; parse PowerShell and check diff.
- [x] Correct shutdown project-root lookup for standalone with a red/green regression.
- [x] Build the new shutdown route and verify a real launch after the user authorizes restarting the current server.
- [x] Record results. No commit or push without a new request.

Verification: 5 files / 13 tests passed; targeted ESLint, TypeScript and PowerShell parser passed. VBScript command construction was executed with service launch replaced by echo (Windows tests require execution outside sandbox). After the user approved restart, verified owned services were stopped, final production build and asset sync passed, and SuperK-Production.vbs launched real Node/OCR services. Both web and OCR health returned HTTP 200. New services use absolute owned entrypoints and hidden startup flags; native window visibility was not inspected. Logs are stored in .superk-runtime. No commit or push performed.
