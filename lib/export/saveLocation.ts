// Save-location helpers: optionally let the user pick a destination folder
// for exports via the File System Access API (Chromium desktop browsers).
// Everywhere else (Firefox, Safari, mobile) exports fall back to the normal
// browser download flow.

export const EXPORT_ASK_DIRECTORY_KEY = "superk_export_ask_directory";
export const EXPORT_DIRECTORY_NAME_KEY = "superk_export_directory_name";

let inMemoryDirectoryHandle: DirectoryHandleLike | null = null;

const IDB_NAME = "SuperKExportDB";
const IDB_STORE = "directory_handles";
const IDB_KEY = "export_directory";

async function getStoredDirectoryHandle(): Promise<DirectoryHandleLike | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(IDB_STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          resolve(null);
          return;
        }
        const tx = db.transaction(IDB_STORE, "readonly");
        const store = tx.objectStore(IDB_STORE);
        const getReq = store.get(IDB_KEY);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function storeDirectoryHandle(handle: DirectoryHandleLike | null): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(IDB_STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          resolve();
          return;
        }
        const tx = db.transaction(IDB_STORE, "readwrite");
        const store = tx.objectStore(IDB_STORE);
        try {
          if (handle) {
            store.put(handle, IDB_KEY);
          } else {
            store.delete(IDB_KEY);
          }
        } catch {
          // If handle cannot be cloned into IndexedDB (e.g. some mocks), ignore gracefully.
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export const getRememberedDirectoryName = (): string => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return "";
    return window.localStorage.getItem(EXPORT_DIRECTORY_NAME_KEY) || "";
  } catch {
    return "";
  }
};

export const setRememberedDirectoryName = (name: string): void => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (name) window.localStorage.setItem(EXPORT_DIRECTORY_NAME_KEY, name);
    else window.localStorage.removeItem(EXPORT_DIRECTORY_NAME_KEY);
  } catch {
    // Storage blocked.
  }
};

/**
 * Returns the currently remembered directory handle (from memory or persisted IndexedDB).
 * If permission needs to be checked/requested, it queries it.
 */
export const getRememberedDirectory = async (): Promise<DirectoryHandleLike | null> => {
  if (inMemoryDirectoryHandle) return inMemoryDirectoryHandle;
  const stored = await getStoredDirectoryHandle();
  if (stored) {
    try {
      if (typeof (stored as any).queryPermission === "function") {
        const perm = await (stored as any).queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          inMemoryDirectoryHandle = stored;
          return stored;
        }
        if (perm === "prompt" && typeof (stored as any).requestPermission === "function") {
          const req = await (stored as any).requestPermission({ mode: "readwrite" });
          if (req === "granted") {
            inMemoryDirectoryHandle = stored;
            return stored;
          }
        }
      } else {
        inMemoryDirectoryHandle = stored;
        return stored;
      }
    } catch {
      // Permission query error -> fall through to null
    }
  }
  return null;
};

/**
 * Saves a directory handle to memory, updates the folder name in localStorage,
 * and persists the handle to IndexedDB.
 */
export const setRememberedDirectory = async (
  handle: DirectoryHandleLike | null,
): Promise<void> => {
  inMemoryDirectoryHandle = handle;
  if (handle) {
    setRememberedDirectoryName(handle.name || "โฟลเดอร์ที่เลือก");
    await storeDirectoryHandle(handle);
  } else {
    setRememberedDirectoryName("");
    await storeDirectoryHandle(null);
  }
};

/**
 * Clears the remembered directory from memory, localStorage, and IndexedDB.
 */
export const clearRememberedDirectory = async (): Promise<void> => {
  await setRememberedDirectory(null);
};

/**
 * Always opens the directory picker and saves the chosen directory if selected.
 */
export const pickAndRememberExportDirectory = async (): Promise<DirectoryHandleLike | null> => {
  const handle = await pickExportDirectory();
  if (handle) {
    await setRememberedDirectory(handle);
  }
  return handle;
};

/**
 * Primary helper for exports: returns the already-remembered directory handle if available,
 * otherwise prompts the user to pick once, remembers it, and returns it.
 */
export const getOrPickExportDirectory = async (): Promise<DirectoryHandleLike | null> => {
  const existing = await getRememberedDirectory();
  if (existing) return existing;
  return await pickAndRememberExportDirectory();
};

export const _resetMemoryDirectoryForTesting = (): void => {
  inMemoryDirectoryHandle = null;
};

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

/**
 * Checks if a file exists in the directory. If it does, generates a non-colliding
 * unique filename with " (1)", " (2)", etc. (e.g. "SuperK_Translations (1).zip").
 */
export const resolveUniqueFilename = async (
  directory: DirectoryHandleLike,
  desiredFilename: string,
): Promise<string> => {
  const dotIndex = desiredFilename.lastIndexOf(".");
  const rawBase = dotIndex > 0 ? desiredFilename.substring(0, dotIndex) : desiredFilename;
  const ext = dotIndex > 0 ? desiredFilename.substring(dotIndex) : "";

  // Check if desiredFilename already ends with " (N)"
  const match = rawBase.match(/^(.*?)\s*\((\d+)\)$/);
  const base = match ? match[1] : rawBase;
  let counter = match ? parseInt(match[2], 10) + 1 : 1;

  let candidate = desiredFilename;

  while (true) {
    try {
      await directory.getFileHandle(candidate, { create: false });
      // If getFileHandle succeeds with create: false, the file already exists in this folder.
      candidate = `${base} (${counter})${ext}`;
      counter++;
    } catch {
      // File does not exist (NotFoundError) or cannot be retrieved -> candidate is available!
      return candidate;
    }
  }
};

export const writeBlobToDirectory = async (
  directory: DirectoryHandleLike,
  filename: string,
  blob: Blob,
): Promise<string> => {
  const uniqueName = await resolveUniqueFilename(directory, filename);
  const fileHandle = await directory.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return uniqueName;
};

/** Writes the blob into the picked directory (with automatic duplicate renaming),
 *  or falls back to a standard browser download. Returns the saved filename. */
export const saveBlob = async (
  blob: Blob,
  filename: string,
  directory?: DirectoryHandleLike | null,
): Promise<string> => {
  if (directory) {
    return await writeBlobToDirectory(directory, filename, blob);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return filename;
};
