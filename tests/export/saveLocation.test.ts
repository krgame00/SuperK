import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DirectoryHandleLike,
  EXPORT_ASK_DIRECTORY_KEY,
  EXPORT_DIRECTORY_NAME_KEY,
  getAskExportDirectory,
  getOrPickExportDirectory,
  getRememberedDirectory,
  getRememberedDirectoryName,
  isDirectoryPickerSupported,
  pickAndRememberExportDirectory,
  pickExportDirectory,
  resolveUniqueFilename,
  saveBlob,
  setAskExportDirectory,
  setRememberedDirectory,
  setRememberedDirectoryName,
  clearRememberedDirectory,
  writeBlobToDirectory,
  _resetMemoryDirectoryForTesting,
} from "@/lib/export/saveLocation";

const storageValues = new Map<string, string>();
const storage = {
  get length() { return storageValues.size; },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => { storageValues.delete(key); },
  setItem: (key: string, value: string) => { storageValues.set(key, String(value)); },
} satisfies Storage;

function createMockDirectory(existingFiles: string[] = []): DirectoryHandleLike & {
  createdFiles: Map<string, Blob>;
} {
  const files = new Set(existingFiles);
  const createdFiles = new Map<string, Blob>();

  return {
    name: "test-directory",
    createdFiles,
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!options?.create) {
        if (!files.has(name)) {
          const err = new Error("File not found");
          err.name = "NotFoundError";
          throw err;
        }
        return {
          async createWritable() {
            throw new Error("Read-only handle");
          },
        };
      }

      files.add(name);
      return {
        async createWritable() {
          let writtenData: Blob | null = null;
          return {
            async write(data: Blob) {
              writtenData = data;
            },
            async close() {
              if (writtenData) createdFiles.set(name, writtenData);
            },
          };
        },
      };
    },
  };
}

beforeEach(() => {
  storageValues.clear();
  _resetMemoryDirectoryForTesting();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
});

describe("export save-location preference", () => {
  it("defaults to off", () => {
    expect(getAskExportDirectory()).toBe(false);
  });

  it("persists the toggle in localStorage", () => {
    setAskExportDirectory(true);
    expect(getAskExportDirectory()).toBe(true);
    expect(storageValues.get(EXPORT_ASK_DIRECTORY_KEY)).toBe("1");

    setAskExportDirectory(false);
    expect(getAskExportDirectory()).toBe(false);
    expect(storageValues.has(EXPORT_ASK_DIRECTORY_KEY)).toBe(false);
  });
});

describe("directory picker", () => {
  it("reports unsupported in environments without showDirectoryPicker", () => {
    expect(isDirectoryPickerSupported()).toBe(false);
  });

  it("returns null instead of throwing when the picker is unavailable", async () => {
    await expect(pickExportDirectory()).resolves.toBeNull();
  });
});

describe("resolveUniqueFilename", () => {
  it("returns original filename when no collision exists in destination directory", async () => {
    const dir = createMockDirectory([]);
    const resolved = await resolveUniqueFilename(dir, "SuperK_Translations.zip");
    expect(resolved).toBe("SuperK_Translations.zip");
  });

  it("appends (1) when a file with the same name already exists", async () => {
    const dir = createMockDirectory(["SuperK_Translations.zip"]);
    const resolved = await resolveUniqueFilename(dir, "SuperK_Translations.zip");
    expect(resolved).toBe("SuperK_Translations (1).zip");
  });

  it("increments to (2) when both original and (1) exist", async () => {
    const dir = createMockDirectory([
      "SuperK_Translations.zip",
      "SuperK_Translations (1).zip",
    ]);
    const resolved = await resolveUniqueFilename(dir, "SuperK_Translations.zip");
    expect(resolved).toBe("SuperK_Translations (2).zip");
  });

  it("handles filenames without extensions and existing (N) suffixes", async () => {
    const dir = createMockDirectory(["SuperK_Document (1)"]);
    const resolved = await resolveUniqueFilename(dir, "SuperK_Document (1)");
    expect(resolved).toBe("SuperK_Document (2)");
  });
});

describe("writeBlobToDirectory & saveBlob", () => {
  it("writes blob to directory with auto-renamed filename on collision", async () => {
    const dir = createMockDirectory(["SuperK_Translations.pdf"]);
    const blob = new Blob(["sample data"], { type: "application/pdf" });

    const savedFilename = await writeBlobToDirectory(dir, "SuperK_Translations.pdf", blob);

    expect(savedFilename).toBe("SuperK_Translations (1).pdf");
    expect(dir.createdFiles.has("SuperK_Translations (1).pdf")).toBe(true);
  });

  it("saveBlob calls writeBlobToDirectory when directory handle is provided", async () => {
    const dir = createMockDirectory([]);
    const blob = new Blob(["sample cbz"], { type: "application/zip" });

    const savedName = await saveBlob(blob, "Manga.cbz", dir);
    expect(savedName).toBe("Manga.cbz");
    expect(dir.createdFiles.has("Manga.cbz")).toBe(true);
  });

  it("saveBlob falls back to DOM anchor click when directory is omitted", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    globalThis.URL.createObjectURL = vi.fn(() => "blob:test-url");
    globalThis.URL.revokeObjectURL = vi.fn();

    const blob = new Blob(["hello"], { type: "text/plain" });
    const savedName = await saveBlob(blob, "test.txt", null);

    expect(savedName).toBe("test.txt");
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});

describe("remembered export directory (select once, use everywhere)", () => {
  it("defaults to empty remembered name and null handle", async () => {
    expect(getRememberedDirectoryName()).toBe("");
    expect(await getRememberedDirectory()).toBeNull();
  });

  it("stores and clears directory name in localStorage", () => {
    setRememberedDirectoryName("My Manga Folder");
    expect(getRememberedDirectoryName()).toBe("My Manga Folder");
    expect(storageValues.get(EXPORT_DIRECTORY_NAME_KEY)).toBe("My Manga Folder");

    setRememberedDirectoryName("");
    expect(getRememberedDirectoryName()).toBe("");
    expect(storageValues.has(EXPORT_DIRECTORY_NAME_KEY)).toBe(false);
  });

  it("setRememberedDirectory sets in-memory handle and saves directory name", async () => {
    const dir = createMockDirectory([]);
    dir.name = "Chapter10";

    await setRememberedDirectory(dir);

    expect(await getRememberedDirectory()).toBe(dir);
    expect(getRememberedDirectoryName()).toBe("Chapter10");
  });

  it("clearRememberedDirectory clears handle and folder name", async () => {
    const dir = createMockDirectory([]);
    dir.name = "Chapter10";
    await setRememberedDirectory(dir);

    await clearRememberedDirectory();

    expect(await getRememberedDirectory()).toBeNull();
    expect(getRememberedDirectoryName()).toBe("");
  });

  it("getOrPickExportDirectory reuses existing remembered directory without opening picker", async () => {
    const dir = createMockDirectory([]);
    dir.name = "PersistedFolder";
    await setRememberedDirectory(dir);

    const showPickerSpy = vi.fn();
    (window as any).showDirectoryPicker = showPickerSpy;

    const result = await getOrPickExportDirectory();
    expect(result).toBe(dir);
    expect(showPickerSpy).not.toHaveBeenCalled();
  });

  it("getOrPickExportDirectory prompts picker once when no directory is remembered, then remembers it", async () => {
    const dir = createMockDirectory([]);
    dir.name = "NewlyPickedFolder";

    (window as any).showDirectoryPicker = vi.fn().mockResolvedValue(dir);

    const result = await getOrPickExportDirectory();
    expect(result).toBe(dir);
    expect(getRememberedDirectoryName()).toBe("NewlyPickedFolder");
    expect(await getRememberedDirectory()).toBe(dir);

    // Second call should reuse without invoking showDirectoryPicker again!
    const secondCallResult = await getOrPickExportDirectory();
    expect(secondCallResult).toBe(dir);
    expect((window as any).showDirectoryPicker).toHaveBeenCalledTimes(1);
  });

  it("pickAndRememberExportDirectory opens picker even if a directory was already remembered", async () => {
    const dir1 = createMockDirectory([]);
    dir1.name = "FolderA";
    await setRememberedDirectory(dir1);

    const dir2 = createMockDirectory([]);
    dir2.name = "FolderB";
    (window as any).showDirectoryPicker = vi.fn().mockResolvedValue(dir2);

    const result = await pickAndRememberExportDirectory();
    expect(result).toBe(dir2);
    expect(getRememberedDirectoryName()).toBe("FolderB");
    expect(await getRememberedDirectory()).toBe(dir2);
  });
});

