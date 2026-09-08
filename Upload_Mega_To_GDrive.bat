@echo off
chcp 65001 > nul
title Rclone Move: F:\Mega to gdrive:XBep/6.69

echo ======================================================================
echo   Moving files from F:\Mega to gdrive:XBep/6.69
echo   - Transfers: 4
echo   - Drive Chunk Size: 128M
echo   - Exclude: .tmp*/**
echo ======================================================================
echo.

rclone move "F:\Mega" "gdrive:XBep/6.69" --drive-chunk-size 128M --transfers 4 --checkers 8 --fast-list --exclude ".tmp*/**" -P

echo.
echo ======================================================================
echo   Done!
echo ======================================================================
pause
