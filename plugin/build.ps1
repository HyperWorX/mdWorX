#requires -Version 5.1
# Convenience build script for the mdWorX plugin DLL.
#
# Usage:
#   .\build.ps1                  # configure + build (Release)
#   .\build.ps1 -Config Debug
#   .\build.ps1 -Clean           # nuke build dir first
#   .\build.ps1 -Install         # also copy DLL into DOpus's viewers folder
#
# Requires Visual Studio Build Tools 2022 with VCTools workload installed.
# Finds the developer environment via vswhere.

[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel')]
    [string]$Config = 'Release',
    [switch]$Clean,
    [switch]$Install
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$PluginDir  = Join-Path $RepoRoot 'plugin'
$BuildDir   = Join-Path $RepoRoot 'build-out\cmake'
$OutputDir  = Join-Path $RepoRoot 'build-out'

# Locate VS Build Tools.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    throw "vswhere.exe not found at $vswhere. Install VS Build Tools 2022 (see docs/dev-setup.md)."
}

$vsRoot = & $vswhere -latest -products '*' `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath
if (-not $vsRoot) {
    throw "No VS install with VCTools workload found. Run the install command in docs/dev-setup.md."
}

$cmake = Join-Path $vsRoot 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
if (-not (Test-Path $cmake)) {
    # Fallback: any cmake on PATH.
    $cmake = (Get-Command cmake -ErrorAction SilentlyContinue)?.Source
    if (-not $cmake) {
        throw "cmake.exe not found. VS Build Tools should install it via VCTools workload."
    }
}

if ($Clean -and (Test-Path $BuildDir)) {
    Write-Host "Cleaning $BuildDir..." -ForegroundColor Cyan
    Remove-Item -Recurse -Force $BuildDir
}

if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

Write-Host "Configuring (cmake)..." -ForegroundColor Cyan
& $cmake -S $PluginDir -B $BuildDir -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed (exit $LASTEXITCODE)" }

Write-Host "Building ($Config)..." -ForegroundColor Cyan
& $cmake --build $BuildDir --config $Config --parallel
if ($LASTEXITCODE -ne 0) { throw "cmake build failed (exit $LASTEXITCODE)" }

# Visual Studio is a multi-config generator: cmake puts the DLL under
# build-out/<Config>/ even though RUNTIME_OUTPUT_DIRECTORY says build-out/.
# Check the per-config path first, fall back to the bare path for any
# single-config generators (Ninja, etc).
$dll = Join-Path $OutputDir (Join-Path $Config 'mdWorX.dll')
if (-not (Test-Path $dll)) {
    $dll = Join-Path $OutputDir 'mdWorX.dll'
}
if (-not (Test-Path $dll)) {
    throw "Built DLL not found at $dll. Check build output."
}

Write-Host "`nBuilt: $dll" -ForegroundColor Green

if ($Install) {
    # DOpus viewer plugins live under %APPDATA%\GPSoftware\Directory Opus\Viewers
    # (per-user) or under the install dir (system-wide). Use per-user by default.
    $viewersDir = Join-Path $env:APPDATA 'GPSoftware\Directory Opus\Viewers'
    if (-not (Test-Path $viewersDir)) {
        New-Item -ItemType Directory -Path $viewersDir -Force | Out-Null
    }
    Copy-Item -Path $dll -Destination $viewersDir -Force
    Write-Host "Installed to: $viewersDir" -ForegroundColor Green
    Write-Host "Restart DOpus (File > Exit Directory Opus, then relaunch) for the plugin to load." -ForegroundColor Yellow
}
