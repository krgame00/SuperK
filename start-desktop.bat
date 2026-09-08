@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

title SuperK Manga Translator - Desktop Launcher

echo =====================================================================
echo          SuperK - Manga Translator (Desktop Application)
echo =====================================================================
echo.

set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" (
    echo [ERROR] ไม่พบ Electron ใน node_modules
    echo กรุณารัน npm install ก่อน แล้วลองใหม่อีกครั้ง
    pause
    exit /b 1
)

if not exist "%~dp0ocr-service\venv\Scripts\python.exe" if not exist "%~dp0ocr-service\.venv\Scripts\python.exe" (
    echo [ERROR] ไม่พบ Python virtual environment ใน ocr-service\venv หรือ ocr-service\.venv
    pause
    exit /b 1
)

echo [INFO] กำลังเปิด SuperK Desktop...
echo [INFO] Next.js และ Python OCR Service จะถูกเปิดและปิดโดยตัวโปรแกรมอัตโนมัติ

start "" "%ELECTRON_EXE%" .
exit /b 0
