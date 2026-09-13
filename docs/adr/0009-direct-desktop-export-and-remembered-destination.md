# 0009. Direct Desktop Export and Remembered Destination Policy

Date: 2026-09-13

## Status

Accepted

## Context

SuperK Manga Translator runs both in the web browser and as a packaged Windows desktop application powered by Electron. Previously, exporting files (ZIP, CBZ, PDF, Webtoon Long Strip, and single pages) relied exclusively on web browser primitives: the Chromium `File System Access API` (`window.showDirectoryPicker`) or fallback to simulated anchor downloads (`<a download>.click()`).

This caused friction for users in two major ways:
1. When running inside the Electron desktop application shell, simulated anchor downloads fall back to Chromium's default download manager, which pops up the native Windows "Save As" file picker dialog on every single export.
2. Even when File System Access API is active, Chromium's web security sandbox resets directory handle permissions on restart, prompting the user for read/write confirmation upon each session.

Users require an uninterrupted, deterministic workflow: select an export destination directory once (e.g. `E:\SuperK`), and have all subsequent exports write directly to that location without repeated dialog prompts.

## Decision

1. **Native Desktop Export IPC**
   Expose native IPC channels via Electron `preload.js` and handle them in the Electron main process:
   - `desktop:pick-export-directory`: Opens a native Windows directory selection dialog (`dialog.showOpenDialog`) and returns the chosen absolute path.
   - `desktop:save-export-file`: Directly writes array buffers or base64-encoded files to disk using Node.js filesystem APIs (`fs.promises.writeFile`).
   - `desktop:open-export-directory`: Reveals or opens the destination folder in Windows Explorer via `shell.openPath`.
   - `desktop:resolve-unique-filename`: Deterministically checks for file collisions on disk and computes auto-incremented non-colliding names (e.g., `SuperK_Translations (1).zip`).

2. **Direct Filesystem Writing & Persistence**
   When running inside the desktop shell, the application bypasses browser download managers entirely. The chosen directory path (e.g., `E:\SuperK`) is stored persistently in user preferences (`localStorage` and Electron store). Subsequent exports write directly to disk without opening any file dialogs.

3. **First-Run Behavior**
   If the user has not configured a directory yet:
   - Check if a valid remembered directory path already exists.
   - If no directory is configured, prompt the native folder selector once on the first export, save the chosen path, and proceed with saving.

4. **Collision Policy**
   If a file with the same name already exists in the target directory, automatically append an incrementing suffix `(1)`, `(2)`, etc., preventing accidental loss of previous translations.

5. **Settings Workspace UX**
   In the Workspace Settings modal:
   - Present the current export directory path clearly (e.g. `E:\SuperK`).
   - Provide a "Change Folder" (`เปลี่ยนโฟลเดอร์`) button.
   - Provide an "Open in Explorer" (`เปิดโฟลเดอร์`) button to jump directly to the folder.
   - Provide an "Auto-save without asking" (`บันทึกอัตโนมัติ`) toggle switch, enabled by default when a directory is set.

6. **Web Browser Fallback Parity**
   Non-Electron web clients retain the existing `File System Access API` and standard browser download flows so the web app remains 100% functional outside Electron.

## Consequences

- **Positive**: Zero repeated save-dialog prompts during desktop export sessions. Instant, direct disk writes.
- **Positive**: Path configuration persists reliably across application restarts without browser permission prompt popups.
- **Positive**: Existing translations are safe from accidental overwrite via automatic index incrementing.
- **Positive**: Convenient one-click access to the export folder in Windows Explorer.
- **Trade-off**: Adds desktop-specific IPC handlers to Electron preload and main process; requires mock coverage in web unit tests.
