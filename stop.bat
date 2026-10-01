@echo off
chcp 65001 > nul
cd /d "%~dp0"
title SuperK Manga Translator - Stop All

echo =====================================================================
echo          SuperK - กำลังปิดการทำงานของระบบทั้งหมด...
echo =====================================================================

:: Stop only listeners whose executable and service entrypoint belong to this checkout.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-services.ps1" -ProjectRoot "%~dp0."
if errorlevel 1 (
    echo [WARN] Some processes could not be verified or stopped. See the messages above.
    exit /b 1
)

echo.
echo [OK] ปิดการทำงานของทั้ง Backend และ Frontend เรียบร้อยแล้ว!
ping -n 2 127.0.0.1 > nul
