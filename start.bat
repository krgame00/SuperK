@echo off
chcp 65001 > nul
cd /d "%~dp0"

title SuperK Manga Translator - Desktop Launcher

echo =====================================================================
echo          SuperK - Manga Translator (Desktop Application)
echo =====================================================================
echo.
echo [INFO] กำลังเปิด SuperK Desktop...
echo [INFO] ระบบจะจัดการ Next.js (:3000) และ OCR Service (:8765) ให้อัตโนมัติ
echo.

call "%~dp0start-desktop.bat"
exit /b %errorlevel%
