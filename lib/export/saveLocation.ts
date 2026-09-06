// Save-location helpers: optionally let the user pick a destination folder
// for exports via the File System Access API (Chromium desktop browsers).
// Everywhere else (Firefox, Safari, mobile) exports fall back to the normal
// browser download flow.

export const EXPORT_ASK_DIRECTORY_KEY = "superk_export_ask_directory";

export interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
}

export interface DirectoryHandleLike {
  name?: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

export const isDirectoryPickerSupported = (): boolean =>
  typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

export const getAskExportDirectory = (): boolean => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(EXPORT_ASK_DIRECTORY_KEY) === "1";
  } catch {
    // localStorage throws when storage access is blocked entirely.
    return false;
  }
};

export const setAskExportDirectory = (enabled: boolean): void => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (enabled) window.localStorage.setItem(EXPORT_ASK_DIRECTORY_KEY, "1");
    else window.localStorage.removeItem(EXPORT_ASK_DIRECTORY_KEY);
  } catch {
    // Storage blocked — the toggle just won't persist.
  }
};

/** Opens the folder picker. Returns null when unavailable or the user
 *  dismissed the dialog — callers should fall back to normal downloads. */
export const pickExportDirectory = async (): Promise<DirectoryHandleLike | null> => {
  if (!isDirectoryPickerSupported()) return null;
  try {
    const handle = await window.showDirectoryPicker?.({
      id: "superk-export",
      mode: "readwrite",
    });
    return (handle as unknown as DirectoryHandleLike) ?? null;
  } catch {
    // AbortError = user dismissed the picker; anything else falls back too.
    return null;
  }
};

export const writeBlobToDirectory = async (
  directory: DirectoryHandleLike,
  filename: string,
  blob: Blob,
): Promise<void> => {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
};

/** Writes the blob into the picked directory, or falls back to a standard
 *  browser download (also used as the universal fallback path). */
export const saveBlob = async (
  blob: Blob,
  filename: string,
  directory?: DirectoryHandleLike | null,
): Promise<void> => {
  if (directory) {
    await writeBlobToDirectory(directory, filename, blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
