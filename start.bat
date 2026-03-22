@echo off
title StreamSched
echo.
echo  ==============================
echo   StreamSched - Starting...
echo  ==============================
echo.

REM Check if data/config.json exists
if not exist "data\config.json" (
    echo  First-time setup required.
    echo  Running setup wizard...
    echo.
    node setup.js
    if errorlevel 1 (
        echo Setup failed.
        pause
        exit /b 1
    )
    echo.
)

echo  Starting server... Press Ctrl+C to stop.
echo.
node server.js
pause
