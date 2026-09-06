import { beforeEach, describe, expect, it } from "vitest";

import {
  EXPORT_ASK_DIRECTORY_KEY,
  getAskExportDirectory,
  isDirectoryPickerSupported,
  pickExportDirectory,
  setAskExportDirectory,
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

beforeEach(() => {
  storageValues.clear();
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
