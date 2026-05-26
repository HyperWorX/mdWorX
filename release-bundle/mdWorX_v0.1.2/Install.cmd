@echo off
:: mdWorX installer for Directory Opus
::
:: Just double-click this file. It will:
::   1. Ask for administrator rights (UAC prompt)
::   2. Close Directory Opus
::   3. Copy the plugin into the DOpus Viewers folder
::   4. Restart Directory Opus
::
:: Default install path is C:\Program Files\GPSoftware\Directory Opus.
:: If your DOpus is somewhere else, edit DOPUS_DIR below.

setlocal enableextensions
set "DOPUS_DIR=C:\Program Files\GPSoftware\Directory Opus"
set "VIEWERS_DIR=%DOPUS_DIR%\Viewers"
set "DLL_NAME=mdWorX.dll"
set "ASSETS_NAME=mdWorX_assets"
set "SCRIPT_DIR=%~dp0"

:: Self-elevate if not already running as admin.
net session >nul 2>&1
if not %errorlevel% == 0 (
    echo Requesting administrator rights...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

echo.
echo === mdWorX installer ===
echo.

if not exist "%DOPUS_DIR%" (
    echo ERROR: Directory Opus not found at "%DOPUS_DIR%".
    echo If DOpus is installed somewhere else, edit DOPUS_DIR at the top of this script and re-run.
    echo.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%%DLL_NAME%" (
    echo ERROR: "%DLL_NAME%" not found next to this script.
    echo Make sure you extracted the whole zip and ran this from inside the extracted folder.
    echo.
    pause
    exit /b 1
)
if not exist "%SCRIPT_DIR%%ASSETS_NAME%" (
    echo ERROR: "%ASSETS_NAME%" folder not found next to this script.
    echo Make sure you extracted the whole zip and ran this from inside the extracted folder.
    echo.
    pause
    exit /b 1
)

echo Closing Directory Opus...
if exist "%DOPUS_DIR%\dopusrt.exe" "%DOPUS_DIR%\dopusrt.exe" /closeprogram >nul 2>&1
:waitclose
timeout /t 1 /nobreak >nul 2>&1
tasklist /FI "IMAGENAME eq dopus.exe" 2>nul | find /I "dopus.exe" >nul
if not errorlevel 1 (
    set /a wait_count+=1
    if not "%wait_count%"=="10" goto waitclose
    echo DOpus did not exit cleanly. Forcing...
    taskkill /F /IM dopus.exe >nul 2>&1
    timeout /t 1 /nobreak >nul 2>&1
)

:: Remove any previous mdWorX install so a re-run leaves a clean slate.
del /F /Q "%VIEWERS_DIR%\%DLL_NAME%" >nul 2>&1
rmdir /S /Q "%VIEWERS_DIR%\%ASSETS_NAME%" >nul 2>&1

echo Copying plugin DLL...
copy /Y "%SCRIPT_DIR%%DLL_NAME%" "%VIEWERS_DIR%\" >nul
if errorlevel 1 (
    echo ERROR: failed to copy DLL into "%VIEWERS_DIR%".
    pause
    exit /b 1
)

echo Copying assets...
xcopy /E /I /Y /Q "%SCRIPT_DIR%%ASSETS_NAME%" "%VIEWERS_DIR%\%ASSETS_NAME%\" >nul
if errorlevel 1 (
    echo ERROR: failed to copy assets into "%VIEWERS_DIR%".
    pause
    exit /b 1
)

echo.
echo === Install complete ===
echo Launching DOpus...
start "" "%DOPUS_DIR%\dopus.exe"
timeout /t 2 /nobreak >nul
exit /b 0
