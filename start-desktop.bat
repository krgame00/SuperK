@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

:: Change directory to current script folder
cd /d "%~dp0"

title SuperK Manga Translator - Desktop Launcher

echo =====================================================================
echo          SuperK - Manga Translator (Desktop Application)
echo =====================================================================
echo.

:: 1. Check Node.js and npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบคำสั่ง npm ในเครื่อง กรุณาติดตั้ง Node.js ก่อนเริ่มใช้งาน
    echo ดาวน์โหลดได้ที่: https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Check Python Virtual Environment for OCR Service
set "PYTHON_EXE=%~dp0ocr-service\venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=%~dp0ocr-service\.venv\Scripts\python.exe"
)

if not exist "%PYTHON_EXE%" (
    echo [ERROR] ไม่พบ Python venv ในโฟลเดอร์ ocr-service
    echo กรุณาตรวจสอบว่ามี ocr-service\venv อยู่หรือไม่
    pause
    exit /b 1
)

:: 3. Configure Cache directory if drive F:\ exists
if exist "F:\" (
    set "F_CACHE=F:\manga-cache"
    if not exist "!F_CACHE!\ocr-jobs" mkdir "!F_CACHE!\ocr-jobs" 2>nul
    if not exist "!F_CACHE!\paddle" mkdir "!F_CACHE!\paddle" 2>nul
    if not exist "!F_CACHE!\torch" mkdir "!F_CACHE!\torch" 2>nul
    if not exist "!F_CACHE!\huggingface" mkdir "!F_CACHE!\huggingface" 2>nul
    if not exist "!F_CACHE!\temp" mkdir "!F_CACHE!\temp" 2>nul

    set "SUPERK_CACHE_DIR=!F_CACHE!\ocr-jobs"
    set "PADDLE_HOME=!F_CACHE!\paddle"
    set "TORCH_HOME=!F_CACHE!\torch"
    set "HF_HOME=!F_CACHE!\huggingface"
    set "TEMP=!F_CACHE!\temp"
    echo [INFO] ตรวจพบไดรฟ์ F:\ ตั้งค่า Cache ไปที่ F:\manga-cache เรียบร้อย
)

:: 4. Start Next.js server in background if not already running on port 3000
powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if (!$conn) { exit 1 } else { exit 0 }"
if %errorlevel% neq 0 (
    echo [INFO] เริ่มต้น Next.js Server (Port 3000)...
    start "SuperK - Workspace Server (:3000)" cmd /c "chcp 65001 > nul && cd /d ""%~dp0"" && npm run dev"
    timeout /t 3 /nobreak > nul
)

:: 5. Launch SuperK Electron Desktop App
echo [INFO] กำลังเปิดหน้าต่างโปรแกรม SuperK Desktop...
start "" npx electron .
exit /b 0
