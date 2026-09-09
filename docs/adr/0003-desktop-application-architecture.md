# 0003. Windows Desktop Application Architecture

Date: 2026-09-08

## Status

Accepted — amended 2026-09-09

## Context

SuperK Manga Translator operates as a dual-process application layer: a Python FastAPI service on port `8765` for local neural text detection and inpainting, and a Next.js application on port `3000`. The Windows desktop shell is responsible for presenting these capabilities as one application rather than requiring users to manage terminal processes and browser tabs.

The original decision assumed a large packaged PyTorch environment for LaMa. Packaging work later established a smaller relocatable Windows Python runtime and an ONNX-based production path that can preserve the required local AnimeLaMa capability without making PyTorch a mandatory shipped dependency.

## Decision

1. **Target Platform**
   Target Windows 10/11 x64 as the primary deployment platform.

2. **Shell Engine**
   Use Electron as the desktop application shell. The Electron main process owns application startup and shutdown, starts the local workspace server and Python sidecar, waits for their readiness, presents the dedicated application window, and performs managed shutdown during normal application exit.

3. **Hybrid Processing Model**
   Preserve the hybrid architecture:
   - Local text detection, segmentation, and inpainting execute on the user's machine through the Python sidecar.
   - Gemini translation remains an online operation requiring internet access and an API key.

4. **Windows Local AI Runtime**
   The production Windows AnimeLaMa path uses ONNX Runtime. DirectML is preferred when available and compatible; CPU execution is the supported fallback. PyTorch is not a mandatory packaged dependency for the Windows release.

   A release must validate the actual staged production inference path with a real image and mask. DirectML failure alone does not fail a release when the supported CPU path executes successfully. Failure of both supported providers, a missing model, or an unusable production cleaner route blocks release readiness.

5. **Distribution Format**
   Ship a portable all-in-one Windows artifact containing the Electron shell, Next.js standalone runtime, relocatable Python runtime, required local model assets, and application resources. The user must not need a separate Node, npm, Python, or package installation to launch the program.

6. **Browser Extension Interoperability**
   Retain loopback listeners on `127.0.0.1:3000` and `127.0.0.1:8765` so the existing browser-extension interoperability model remains compatible.

7. **Process Lifecycle and Abnormal Recovery**
   Normal close terminates managed child processes through the desktop lifecycle. A forced termination cannot rely on shutdown hooks, so stale-process recovery happens on the next launch. The application may terminate a stale process only when it can verify that process belongs to SuperK; port occupancy alone is never sufficient ownership evidence. Unknown port owners use the port-conflict flow.

## Consequences

- **Positive**: Users get single-application startup, no manual terminal management, local AI execution, a smaller and more maintainable production runtime than the original mandatory-PyTorch design, GPU acceleration where DirectML is available, and CPU compatibility where it is not.
- **Positive**: Abnormal relaunch recovery avoids unsafe `taskkill` behavior against unrelated applications that happen to use the same ports.
- **Trade-off**: The portable artifact remains substantial because Electron, the relocatable Python runtime, ONNX Runtime, and neural model weights are bundled.
- **Trade-off**: DirectML is an optimization rather than a universal guarantee; some supported systems will execute AnimeLaMa on CPU.
- **Trade-off**: Hard-kill cleanup may be deferred until the next launch because the terminated Electron process cannot execute normal shutdown code.

## Amendment Note

This amendment supersedes only the earlier requirement that the Windows bundle must retain PyTorch/LaMa as the production inpainting runtime. The accepted desktop-shell, hybrid-processing, portable-distribution, and loopback-interoperability decisions remain in force.
