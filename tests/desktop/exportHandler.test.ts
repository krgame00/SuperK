import { describe, it, expect, vi } from "vitest";
import {
  resolveUniqueDesktopFilename,
  saveExportFile,
  pickExportDirectory,
  openExportDirectory,
} from "../../electron/exportHandler.js";

describe("exportHandler - Desktop Export Logic", () => {
  describe("resolveUniqueDesktopFilename", () => {
    it("returns original filename when no file with that name exists", () => {
      const existsMock = vi.fn(() => false);
      const name = resolveUniqueDesktopFilename("E:\\SuperK", "SuperK_Translations.zip", existsMock);
      expect(name).toBe("SuperK_Translations.zip");
      expect(existsMock).toHaveBeenCalledTimes(1);
    });

    it("appends (1) when original filename already exists", () => {
      const existsMock = vi.fn((filePath: any) => {
        return String(filePath).endsWith("SuperK_Translations.zip");
      });
      const name = resolveUniqueDesktopFilename("E:\\SuperK", "SuperK_Translations.zip", existsMock);
      expect(name).toBe("SuperK_Translations (1).zip");
    });

    it("increments to (2) when (1) already exists", () => {
      const existsMock = vi.fn((filePath: any) => {
        const p = String(filePath);
        return (
          p.endsWith("SuperK_Translations.zip") ||
          p.endsWith("SuperK_Translations (1).zip")
        );
      });
      const name = resolveUniqueDesktopFilename("E:\\SuperK", "SuperK_Translations.zip", existsMock);
      expect(name).toBe("SuperK_Translations (2).zip");
    });

    it("handles filename already containing (1) and increments it", () => {
      const existsMock = vi.fn((filePath: any) => {
        return String(filePath).endsWith("SuperK_Translations (1).pdf");
      });
      const name = resolveUniqueDesktopFilename("E:\\SuperK", "SuperK_Translations (1).pdf", existsMock);
      expect(name).toBe("SuperK_Translations (2).pdf");
    });
  });

  describe("saveExportFile", () => {
    it("creates target directory and writes file buffer directly to disk", async () => {
      const mkdirMock = vi.fn(async () => undefined);
      const writeFileMock = vi.fn(async () => undefined);
      const existsMock = vi.fn(() => false);

      const fakeFs = {
        existsSync: existsMock,
        promises: {
          mkdir: mkdirMock,
          writeFile: writeFileMock,
        },
      };

      const buffer = new Uint8Array([1, 2, 3, 4]);
      const result = await saveExportFile(
        { dirPath: "E:\\SuperK", filename: "SuperK_Translations.zip", buffer },
        fakeFs as any,
      );

      expect(result.success).toBe(true);
      expect(result.savedName).toBe("SuperK_Translations.zip");
      expect(result.fullPath).toContain("SuperK_Translations.zip");
      expect(mkdirMock).toHaveBeenCalledWith("E:\\SuperK", { recursive: true });
      expect(writeFileMock).toHaveBeenCalled();
    });
  });

  describe("pickExportDirectory", () => {
    it("returns directory path when user selects a folder", async () => {
      const dialogMock = {
        showOpenDialog: vi.fn(async () => ({
          canceled: false,
          filePaths: ["E:\\SuperK"],
        })),
      };

      const result = await pickExportDirectory(dialogMock as any);
      expect(result).toBe("E:\\SuperK");
      expect(dialogMock.showOpenDialog).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          properties: expect.arrayContaining(["openDirectory"]),
        }),
      );
    });

    it("returns null when user cancels folder picker", async () => {
      const dialogMock = {
        showOpenDialog: vi.fn(async () => ({
          canceled: true,
          filePaths: [],
        })),
      };

      const result = await pickExportDirectory(dialogMock as any);
      expect(result).toBeNull();
    });
  });

  describe("openExportDirectory", () => {
    it("calls shell.openPath with the given directory path", async () => {
      const shellMock = {
        openPath: vi.fn(async () => ""),
      };

      await openExportDirectory(shellMock as any, "E:\\SuperK");
      expect(shellMock.openPath).toHaveBeenCalledWith("E:\\SuperK");
    });
  });
});
