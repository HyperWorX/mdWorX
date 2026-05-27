@echo off
chcp 65001 >nul

REM Make the console wide enough that the 94-char banner does not
REM wrap (default cmd is 80 cols which scrambles the box drawing).
mode con: cols=100 lines=36 >nul 2>&1

REM Enable ANSI color support
reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1

REM Create ESC character (0x1B) using PowerShell with fallback
set "ESC="
for /f %%a in ('powershell -noprofile -command "[char]27" 2^>nul') do set "ESC=%%a"
if not defined ESC (
    set "ESC=^["
)

setlocal EnableDelayedExpansion

REM mdWorX installer for Directory Opus
REM   1. Show the banner
REM   2. Ask for administrator rights (UAC prompt)
REM   3. Close Directory Opus
REM   4. Copy the plugin into the DOpus Viewers folder
REM   5. Restart Directory Opus
REM
REM Default install path is C:\Program Files\GPSoftware\Directory Opus.
REM If your DOpus is somewhere else, edit DOPUS_DIR below.
set "DOPUS_DIR=C:\Program Files\GPSoftware\Directory Opus"
set "VIEWERS_DIR=%DOPUS_DIR%\Viewers"
set "DLL_NAME=mdWorX.dll"
set "ASSETS_NAME=mdWorX_assets"
set "SCRIPT_DIR=%~dp0"

cls
echo.
echo %ESC%[38;2;255;108;13m╔════════════════════════════════════════════════════════════════════════════════════════════╗%ESC%[0m
echo %ESC%[38;2;255;126;32m║                                                                                            ║%ESC%[0m
echo %ESC%[38;2;255;144;51m║                                ___________       __              __  __                    ║%ESC%[0m
echo %ESC%[38;2;255;162;70m║                     _______ _________  /_ ^|     / /_____________ \ \/ /                    ║%ESC%[0m
echo %ESC%[38;2;255;180;89m║                     __  __ `__ \  __  /__ ^| /^| / /_  __ \_  ___/  \  /                     ║%ESC%[0m
echo %ESC%[38;2;255;198;108m║                     _  / / / / / /_/ / __ ^|/ ^|/ / / /_/ /  /      /  \                     ║%ESC%[0m
echo %ESC%[38;2;255;216;127m║                     /_/ /_/ /_/\__,_/  ____/^|__/  \____//_/      /_/\_\                    ║%ESC%[0m
echo %ESC%[38;2;240;216;144m║                                                                                            ║%ESC%[0m
echo %ESC%[38;2;240;216;144m╠════════════════════════════════════════════════════════════════════════════════════════════╣%ESC%[0m
echo %ESC%[38;2;208;200;160m║                  Markdown viewer and editor plugin for Directory Opus                      ║%ESC%[0m
echo %ESC%[38;2;208;200;160m║                                            by                                              ║%ESC%[0m
echo %ESC%[38;2;176;184;176m║                                ∙◦○◦•●•◦○•●◦○◦●•○◦•●•◦○◦∙                                   ║%ESC%[0m
echo %ESC%[38;2;128;200;200m║                             ∙◦○◦○╔╗╔╗◦○•●•○◦╔╦═╦╗•◦╔╗╔╗○◦○◦∙                               ║%ESC%[0m
echo %ESC%[38;2;112;184;216m║                           ∙◦○•●•○║╚╝╠╦╦═╦═╦═╣║║║╠═╦╩╗╔╝○•●•○◦∙                             ║%ESC%[0m
echo %ESC%[38;2;104;168;224m║                        ∙◦○•●•○•●○║╔╗║║║╬║╩╣╔╣║║║║╬║╔╝╚╗○●○•●•○◦∙                           ║%ESC%[0m
echo %ESC%[38;2;104;144;216m║                           ∙◦○•●•○╚╝╚╬╗║╔╩═╩╝╚═╩═╩═╩╩╝╚╝○•●•○◦∙                             ║%ESC%[0m
echo %ESC%[38;2;101;120;208m║                             ∙◦○◦○◦•●╚═╩╝∙◦○◦∙•●•∙◦○◦•●•○◦○◦∙                               ║%ESC%[0m
echo %ESC%[38;2;101;104;204m║                                ∙◦○◦•●•◦○•●◦○◦●•○◦•●•◦○◦∙                                   ║%ESC%[0m
echo %ESC%[38;2;101;104;204m╚════════════════════════════════════════════════════════════════════════════════════════════╝%ESC%[0m
echo.
echo %ESC%[97mInstalling mdWorX...%ESC%[0m
echo.

REM Self-elevate if not already running as admin. The banner above is printed
REM BEFORE the elevation step so the user sees it in the original window;
REM after UAC accepts, the elevated process reprints it once more (cleared
REM console under a new shell) — that's expected.
net session >nul 2>&1
if not %errorlevel% == 0 (
    echo %ESC%[97mRequesting administrator rights...%ESC%[0m
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

if not exist "%DOPUS_DIR%" (
    echo %ESC%[91mERROR: Directory Opus not found at "%DOPUS_DIR%".%ESC%[0m
    echo If DOpus is installed somewhere else, edit DOPUS_DIR at the top of this script and re-run.
    echo.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%%DLL_NAME%" (
    echo %ESC%[91mERROR: "%DLL_NAME%" not found next to this script.%ESC%[0m
    echo Make sure you extracted the whole zip and ran this from inside the extracted folder.
    echo.
    pause
    exit /b 1
)
if not exist "%SCRIPT_DIR%%ASSETS_NAME%" (
    echo %ESC%[91mERROR: "%ASSETS_NAME%" folder not found next to this script.%ESC%[0m
    echo Make sure you extracted the whole zip and ran this from inside the extracted folder.
    echo.
    pause
    exit /b 1
)

echo %ESC%[96mClosing Directory Opus...%ESC%[0m
if exist "%DOPUS_DIR%\dopusrt.exe" "%DOPUS_DIR%\dopusrt.exe" /closeprogram >nul 2>&1
:waitclose
timeout /t 1 /nobreak >nul 2>&1
tasklist /FI "IMAGENAME eq dopus.exe" 2>nul | find /I "dopus.exe" >nul
if not errorlevel 1 (
    set /a wait_count+=1
    if not "%wait_count%"=="10" goto waitclose
    echo %ESC%[93mDOpus did not exit cleanly. Forcing...%ESC%[0m
    taskkill /F /IM dopus.exe >nul 2>&1
    timeout /t 1 /nobreak >nul 2>&1
)

REM Remove any previous mdWorX install so a re-run leaves a clean slate.
del /F /Q "%VIEWERS_DIR%\%DLL_NAME%" >nul 2>&1
rmdir /S /Q "%VIEWERS_DIR%\%ASSETS_NAME%" >nul 2>&1

echo %ESC%[96mCopying plugin DLL...%ESC%[0m
copy /Y "%SCRIPT_DIR%%DLL_NAME%" "%VIEWERS_DIR%\" >nul
if errorlevel 1 (
    echo %ESC%[91mERROR: failed to copy DLL into "%VIEWERS_DIR%".%ESC%[0m
    pause
    exit /b 1
)

echo %ESC%[96mCopying assets...%ESC%[0m
xcopy /E /I /Y /Q "%SCRIPT_DIR%%ASSETS_NAME%" "%VIEWERS_DIR%\%ASSETS_NAME%\" >nul
if errorlevel 1 (
    echo %ESC%[91mERROR: failed to copy assets into "%VIEWERS_DIR%".%ESC%[0m
    pause
    exit /b 1
)

echo.
echo %ESC%[92m══════════════════════════════════════════════%ESC%[0m
echo %ESC%[92m  mdWorX installed.%ESC%[0m
echo %ESC%[92m══════════════════════════════════════════════%ESC%[0m
echo.
echo %ESC%[97mLaunching Directory Opus...%ESC%[0m
start "" "%DOPUS_DIR%\dopus.exe"
timeout /t 2 /nobreak >nul
exit /b 0
