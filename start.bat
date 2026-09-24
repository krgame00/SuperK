@echo off
chcp 65001 > nul
cd /d "%~dp0"

start "" wscript.exe "%~dp0SuperK-Launcher.vbs"
exit /b 0
