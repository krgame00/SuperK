import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("SuperK Smart Desktop Launcher", () => {
  const rootDir = process.cwd();
  const launcherPath = path.join(rootDir, "SuperK-Launcher.vbs");
  const setupScriptPath = path.join(rootDir, "scripts", "create-desktop-shortcut.mjs");
  const startBatPath = path.join(rootDir, "start.bat");

  it("ensures SuperK-Launcher.vbs exists, checks health, and launches in standard browser tab mode", () => {
    expect(fs.existsSync(launcherPath)).toBe(true);
    const content = fs.readFileSync(launcherPath, "utf-8");
    expect(content).toContain("start-production.ps1");
    expect(content).toContain("production-watchdog.ps1");
    const supervisorPath = path.join(rootDir, "scripts", "start-production.ps1");
    expect(fs.existsSync(supervisorPath)).toBe(true);
    const supervisorContent = fs.readFileSync(supervisorPath, "utf-8");
    expect(supervisorContent).toContain("127.0.0.1:3000");
    expect(supervisorContent).toContain("127.0.0.1:8765");
    expect(supervisorContent).toContain("Test-SuperKHealth");
  });

  it("ensures create-desktop-shortcut.mjs exists and targets silent launcher", () => {
    expect(fs.existsSync(setupScriptPath)).toBe(true);
    const content = fs.readFileSync(setupScriptPath, "utf-8");
    expect(content).toContain("SuperK-Launcher.vbs");
    expect(content).toContain("SuperK Manga Translator.lnk");
  });

  it("ensures start.bat executes SuperK-Launcher.vbs", () => {
    expect(fs.existsSync(startBatPath)).toBe(true);
    const content = fs.readFileSync(startBatPath, "utf-8");
    expect(content).toContain("SuperK-Launcher.vbs");
  });
});
