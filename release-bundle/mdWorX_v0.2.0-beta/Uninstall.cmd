@echo off
chcp 65001 >nul

REM Enable ANSI color support
reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1

set "ESC="
for /f %%a in ('powershell -noprofile -command "[char]27" 2^>nul') do set "ESC=%%a"
if not defined ESC (
    set "ESC=^["
)

setlocal EnableDelayedExpansion

set "DOPUS_DIR=C:\Program Files\GPSoftware\Directory Opus"
set "VIEWERS_DIR=%DOPUS_DIR%\Viewers"
set "DLL_NAME=mdWorX.dll"
set "ASSETS_NAME=mdWorX_assets"

cls
echo.
echo %ESC%[38;2;255;108;13m╔════════════════════════════════════════════════════════════════════════════════════════════╗%ESC%[0m
echo %ESC%[38;2;255;126;32m║                                                                                            ║%ESC%[0m
echo %ESC%[38;2;255;144;51m║                                ___________       __            ____  __                    ║%ESC%[0m
echo %ESC%[38;2;255;162;70m║                     _______ _________  /_ ^|     / /______________  ^|/ /                    ║%ESC%[0m
echo %ESC%[38;2;255;180;89m║                     __  __ `__ \  __  /__ ^| /^| / /_  __ \_  ___/_    /                     ║%ESC%[0m
echo %ESC%[38;2;255;198;108m║                     _  / / / / / /_/ / __ ^|/ ^|/ / / /_/ /  /   _    ^|                      ║%ESC%[0m
echo %ESC%[38;2;255;216;127m║                     /_/ /_/ /_/\__,_/  ____/^|__/  \____//_/    /_/^|_^|                      ║%ESC%[0m
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
echo %ESC%[97mInitializing mdWorX uninstaller...%ESC%[0m
echo.

choice /M "Remove mdWorX from Directory Opus?"
if errorlevel 2 (
    echo.
    echo %ESC%[93mUninstall cancelled by user.%ESC%[0m
    exit /b 0
)
echo.

net session >nul 2>&1
if not %errorlevel% == 0 (
    echo %ESC%[97mRequesting administrator rights...%ESC%[0m
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

if exist "%DOPUS_DIR%\dopusrt.exe" (
    echo %ESC%[96mClosing Directory Opus...%ESC%[0m
    "%DOPUS_DIR%\dopusrt.exe" /closeprogram >nul 2>&1
    timeout /t 3 /nobreak >nul
    tasklist /FI "IMAGENAME eq dopus.exe" 2>nul | find /I "dopus.exe" >nul
    if not errorlevel 1 taskkill /F /IM dopus.exe >nul 2>&1
)

echo %ESC%[96mRemoving plugin files...%ESC%[0m
del /F /Q "%VIEWERS_DIR%\%DLL_NAME%" >nul 2>&1
rmdir /S /Q "%VIEWERS_DIR%\%ASSETS_NAME%" >nul 2>&1

echo.
echo %ESC%[92m══════════════════════════════════════════════%ESC%[0m
echo %ESC%[92m  mdWorX removed.%ESC%[0m
echo %ESC%[92m══════════════════════════════════════════════%ESC%[0m
echo.
echo You can re-launch Directory Opus normally now.
timeout /t 2 /nobreak >nul
exit /b 0
