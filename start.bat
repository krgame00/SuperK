@echo off
chcp 65001 > nul
cd /d "%~dp0"

set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if exist "%~dp0SuperK.vbs" if exist "%ELECTRON_EXE%" (
    start "" wscript.exe "%~dp0SuperK.vbs"
    exit /b 0
)

call "%~dp0start-desktop.bat"
exit /b %errorlevel%
