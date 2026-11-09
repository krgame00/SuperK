@echo off
chcp 65001 > nul
cd /d "%~dp0"
title SuperK Manga Translator - Create Desktop Shortcut

echo =====================================================================
echo          SuperK - สร้างชอร์ตคัตบนหน้าจอ Windows (Desktop)
echo =====================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-desktop-shortcut.ps1" -ProjectRoot "%~dp0."
if errorlevel 1 (
    echo.
    echo [ERROR] ไม่สามารถสร้าง Desktop Shortcut ได้ กรุณาตรวจสอบสิทธิ์ของระบบ
    pause
    exit /b 1
)

echo.
echo กดปุ่มใดๆ เพื่อปิดหน้าต่างนี้...
pause > nul
exit /b 0
