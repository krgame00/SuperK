/**
 * SuperK — Manga Translator
 * Electron Main Process — Native Desktop Export Handler
 *
 * Responsibilities:
 *  - Native directory selection via dialog.showOpenDialog
 *  - Direct filesystem writing via Node.js fs.promises.writeFile
 *  - Auto-increment collision detection: "SuperK_Translations (1).zip"
 *  - Shell directory opening via shell.openPath
 */

const path = require("path");
const defaultFs = require("fs");

/**
 * Resolves an auto-incrementing filename if a collision exists on disk.
 */
function resolveUniqueDesktopFilename(dirPath, desiredFilename, fileExistsFn = defaultFs.existsSync) {
  const dotIndex = desiredFilename.lastIndexOf(".");
  const rawBase = dotIndex > 0 ? desiredFilename.substring(0, dotIndex) : desiredFilename;
  const ext = dotIndex > 0 ? desiredFilename.substring(dotIndex) : "";

  const match = rawBase.match(/^(.*?)\s*\((\d+)\)$/);
  const base = match ? match[1] : rawBase;
  let counter = match ? parseInt(match[2], 10) + 1 : 1;

  let candidate = desiredFilename;

  while (true) {
    const fullPath = path.join(dirPath, candidate);
    if (!fileExistsFn(fullPath)) {
      return candidate;
    }
    candidate = `${base} (${counter})${ext}`;
    counter++;
  }
}

/**
 * Directly writes an ArrayBuffer / Buffer to the target directory on disk.
 */
async function saveExportFile({ dirPath, filename, buffer }, fsModule = defaultFs) {
  if (!dirPath) {
    throw new Error("Target directory path is required for desktop export");
  }

  const mkdirFn = fsModule.promises?.mkdir || defaultFs.promises.mkdir;
  const writeFileFn = fsModule.promises?.writeFile || defaultFs.promises.writeFile;
  const existsFn = fsModule.existsSync || defaultFs.existsSync;

  await mkdirFn(dirPath, { recursive: true });

  const uniqueName = resolveUniqueDesktopFilename(dirPath, filename, existsFn);
  const targetPath = path.join(dirPath, uniqueName);

  const writeData = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);

  await writeFileFn(targetPath, writeData);

  return {
    success: true,
    savedName: uniqueName,
    fullPath: targetPath,
  };
}

/**
 * Prompts native directory selection dialog and returns the selected folder path.
 */
async function pickExportDirectory(dialog, parentWindow) {
  if (!dialog || typeof dialog.showOpenDialog !== "function") {
    return null;
  }
  const result = await dialog.showOpenDialog(parentWindow, {
    title: "เลือกโฟลเดอร์สำหรับบันทึกไฟล์แปล SuperK",
    properties: ["openDirectory", "createDirectory"],
  });

  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
}

/**
 * Opens the export directory in Windows Explorer.
 */
async function openExportDirectory(shell, dirPath) {
  if (!shell || typeof shell.openPath !== "function" || !dirPath) {
    return "";
  }
  return await shell.openPath(dirPath);
}

module.exports = {
  resolveUniqueDesktopFilename,
  saveExportFile,
  pickExportDirectory,
  openExportDirectory,
};
