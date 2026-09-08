@echo off
chcp 65001 > nul
cd /d "%~dp0"
title SuperK Manga Translator - Stop All

echo =====================================================================
echo          SuperK - กำลังปิดการทำงานของระบบทั้งหมด...
echo =====================================================================

:: Close console windows with SuperK titles
taskkill /f /fi "WINDOWTITLE eq SuperK - Backend*" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq SuperK - Frontend*" >nul 2>&1

:: Safely kill processes occupying port 8765 and port 3000
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8765,3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

echo.
echo [OK] ปิดการทำงานของทั้ง Backend และ Frontend เรียบร้อยแล้ว!
ping -n 2 127.0.0.1 > nul