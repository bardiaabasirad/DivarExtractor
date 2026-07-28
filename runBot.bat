@echo off
chcp 65001 >nul
echo.
echo ===== Select City =====
echo 1. Khorramabad
echo 2. Nurabad (Delfan)
echo.
set /p choice="Enter city number: "

if "%choice%"=="1" set CITY=khorramabad
if "%choice%"=="2" set CITY=nurabad

if not defined CITY (
    echo Invalid selection.
    pause
    exit /b 1
)

echo Selected city: %CITY%
node index.js
pause
