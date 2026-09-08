import fs from "fs";
import path from "path";

const rootDir = process.cwd();

// Primary launcher: desktop mode only. Electron owns both local services so
// users do not get separate Backend/Frontend terminal windows.
const startBatContent = [
  "@echo off",
  "chcp 65001 > nul",
  "cd /d \"%~dp0\"",
  "",
  "title SuperK Manga Translator - Desktop Launcher",
  "",
  "echo =====================================================================",
  "echo          SuperK - Manga Translator (Desktop Application)",
  "echo =====================================================================",
  "echo.",
  "echo [INFO] กำลังเปิด SuperK Desktop...",
  "echo [INFO] ระบบจะจัดการ Next.js (:3000) และ OCR Service (:8765) ให้อัตโนมัติ",
  "echo.",
  "",
  "call \"%~dp0start-desktop.bat\"",
  "exit /b %errorlevel%",
].join("\r\n");

// Emergency cleanup helper. Normally closing the Electron window shuts both
// child services down automatically; this remains useful after a crash.
const stopBatContent = [
  "@echo off",
  "chcp 65001 > nul",
  "cd /d \"%~dp0\"",
  "title SuperK Manga Translator - Stop All",
  "",
  "echo =====================================================================",
  "echo          SuperK - กำลังปิดการทำงานของระบบทั้งหมด...",
  "echo =====================================================================",
  "",
  ":: Close legacy development console windows if any remain",
  "taskkill /f /fi \"WINDOWTITLE eq SuperK - Backend*\" >nul 2>&1",
  "taskkill /f /fi \"WINDOWTITLE eq SuperK - Frontend*\" >nul 2>&1",
  "",
  ":: Safely stop processes occupying SuperK's local ports",
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Get-NetTCPConnection -LocalPort 8765,3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }\"",
  "",
  "echo.",
  "echo [OK] ปิด Backend และ Frontend เรียบร้อยแล้ว",
  "ping -n 2 127.0.0.1 > nul",
].join("\r\n");

fs.writeFileSync(path.join(rootDir, "start.bat"), startBatContent, "utf8");
fs.writeFileSync(path.join(rootDir, "stop.bat"), stopBatContent, "utf8");

console.log("Successfully generated desktop start.bat and stop.bat with CRLF!");
