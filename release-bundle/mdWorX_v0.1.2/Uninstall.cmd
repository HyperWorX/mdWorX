@echo off
:: mdWorX uninstaller
::
:: Double-click. Removes the plugin DLL and assets from the DOpus Viewers folder.

setlocal enableextensions
set "DOPUS_DIR=C:\Program Files\GPSoftware\Directory Opus"
set "VIEWERS_DIR=%DOPUS_DIR%\Viewers"
set "DLL_NAME=mdWorX.dll"
set "ASSETS_NAME=mdWorX_assets"

net session >nul 2>&1
if not %errorlevel% == 0 (
    echo Requesting administrator rights...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

echo.
echo === mdWorX uninstaller ===
echo.

if exist "%DOPUS_DIR%\dopusrt.exe" (
    echo Closing Directory Opus...
    "%DOPUS_DIR%\dopusrt.exe" /closeprogram >nul 2>&1
    timeout /t 3 /nobreak >nul
    tasklist /FI "IMAGENAME eq dopus.exe" 2>nul | find /I "dopus.exe" >nul
    if not errorlevel 1 taskkill /F /IM dopus.exe >nul 2>&1
)

del /F /Q "%VIEWERS_DIR%\%DLL_NAME%" >nul 2>&1
rmdir /S /Q "%VIEWERS_DIR%\%ASSETS_NAME%" >nul 2>&1

echo Removed.
echo You can re-launch DOpus normally now.
timeout /t 2 /nobreak >nul
exit /b 0
