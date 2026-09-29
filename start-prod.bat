@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

:: Change directory to current script folder
cd /d "%~dp0"

title SuperK Manga Translator - Production Mode

echo =====================================================================
echo    SuperK - Production Mode (High Performance / Low Memory)
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
set "UVICORN_EXE=%~dp0ocr-service\venv\Scripts\uvicorn.exe"
if not exist "%UVICORN_EXE%" (
    set "UVICORN_EXE=%~dp0ocr-service\.venv\Scripts\uvicorn.exe"
)

if not exist "%UVICORN_EXE%" (
    echo [ERROR] ไม่พบ uvicorn ในโฟลเดอร์ ocr-service\venv\Scripts
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

:: 4. Check if Production Build exists
if not exist "%~dp0.next\standalone\server.js" (
    echo [INFO] ยังไม่พบ Production Build กำลังทำการ Compile ครั้งแรก...
    echo กรุณารอสักครู่ [ทำครั้งเดียวประมาณ 20-30 วินาที]...
    call npm run build
    if !errorlevel! neq 0 (
        echo [ERROR] การ Build ไม่สำเร็จ
        pause
        exit /b 1
    )
)

:: Configure Environment File if present
set "ENV_ARG="
if exist "%~dp0.env.local" set "ENV_ARG=--env-file="%~dp0.env.local""
if not defined ENV_ARG if exist "%~dp0.env" set "ENV_ARG=--env-file="%~dp0.env""

:: 5. Start Backend OCR Service (Port 8765)
echo [1/2] กำลังเปิด Backend OCR Service (Port 8765)...
start /min "SuperK - Backend OCR Cleaner (:8765)" cmd /k "chcp 65001 > nul && title SuperK - Backend OCR Cleaner (:8765) && cd /d "%~dp0ocr-service" && "%UVICORN_EXE%" app.api:app --host 127.0.0.1 --port 8765"

:: 6. Start Frontend Standalone Server (Port 3000)
echo [2/2] กำลังเปิด Frontend Production Server (Port 3000)...
start /min "SuperK - Frontend Web Prod (:3000)" cmd /k "chcp 65001 > nul && title SuperK - Frontend Web Prod (:3000) && cd /d "%~dp0" && set "PORT=3000" & set "HOSTNAME=127.0.0.1" & node %ENV_ARG% .next\standalone\server.js"

:: 7. Wait for servers to initialize
echo.
echo รอระบบเริ่มต้นสักครู่ (กำลังเปิดหน้าเว็บเบราว์เซอร์)...
ping -n 5 127.0.0.1 > nul

:: Open Browser
start http://127.0.0.1:3000

:MENU
cls
echo =====================================================================
echo    SuperK - Manga Translator [โหมด Production: ประหยัดแรม]
echo =====================================================================
echo.
echo   [●] Frontend Web App (Prod): http://127.0.0.1:3000
echo   [●] Backend OCR Service:     http://127.0.0.1:8765
echo.
echo ---------------------------------------------------------------------
echo   คำสั่งควบคุม:
echo     [1] เปิดหน้าเว็บ SuperK อีกครั้งใน Browser
echo     [2] ตรวจสอบสถานะ Backend (Health Check)
echo     [B] ทำการ Re-Build โค้ดใหม่
echo     [Q] ปิดระบบทั้งหมด (Stop All Services)
echo ---------------------------------------------------------------------
echo.

choice /c 12BQ /n /m "กรุณากดเลือก [1, 2, B, Q]: "

if errorlevel 4 goto STOP_ALL
if errorlevel 3 goto REBUILD
if errorlevel 2 goto HEALTH_CHECK
if errorlevel 1 goto OPEN_BROWSER

:OPEN_BROWSER
start http://127.0.0.1:3000
goto MENU

:HEALTH_CHECK
start http://127.0.0.1:8765/health
goto MENU

:REBUILD
echo.
echo กำลัง Re-Build Production Bundle...
call npm run build
echo Build เสร็จสิ้น! กรุณาปิดและเปิด start-prod.bat ใหม่อีกครั้ง
pause
goto MENU

:STOP_ALL
echo.
echo กำลังปิดการทำงานของระบบ SuperK...
call "%~dp0stop.bat"
exit /b 0
