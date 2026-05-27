# Developer setup

## Toolchain

- Visual Studio Build Tools 2022 with VCTools workload and Windows 11 SDK 10.0.26100 (or newer).
- Node.js 20 or later (for the web layer build).
- Git.
- (Optional) VS Code or any editor with C++ support.

Install Build Tools via either:

```
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe" install --productId Microsoft.VisualStudio.Product.BuildTools --channelId VisualStudio.17.Release --config "plugin\install.vsconfig" --passive --norestart
```

or interactively via the Visual Studio Installer GUI, selecting "Desktop development with C++" workload.

## DOpus SDK

The SDK is **not** committed to this repo (GPSoftware's licence does not permit redistribution). Download and extract it yourself:

1. Download `opus_sdk.zip` from `https://cdn.gpsoft.com.au/files/Misc/opus_sdk.zip` (or follow GPSoftware's site → Support → Self Service → Resources).
2. Extract into `sdk-vendored/` at the repo root, so the layout matches:
   ```
   sdk-vendored/
     headers/
       plugin support.h
       vfs plugins.h
       viewer plugins.h
     Viewer Plugin SDK.pdf
     Plugin Support API SDK.pdf
     ...
   ```

The build system expects this path.

## Build the web layer

From the repo root:

```
cd web
npm install
npm run build
```

Output lands in `web/dist/` and is copied next to the DLL during the C++ build's POST_BUILD step.

### Iterative web development against the live install

When iterating on web files only (no native rebuild needed), the staged copy next to the DLL is what DOpus actually reads — not `web/dist/` and not the release bundle. After each `npm run build`, copy the contents of `build-out/mdWorX_assets/` into the live install location (the same path you copied the DLL to in the Install section below). DOpus reads the assets on viewer pane open, so a viewer restart (close + reopen the pane) is enough to pick up the new bundle — no DOpus restart needed.

## Build the plugin

From the repo root:

```
cd plugin
.\build.ps1
```

Output: `build-out\Release\mdWorX.dll` plus the staged `build-out\mdWorX_assets\` folder.

The script accepts a `-Install` switch that also copies the freshly-built DLL into the per-user DOpus viewers folder (`%APPDATA%\GPSoftware\Directory Opus\Viewers\`) — no admin required, no manual file ops, but note that this is the per-user path. The README documents the system Program Files path used by the full install pipeline; `-Install` is the developer shortcut for iterative work.

## Install the built plugin into DOpus

For a one-off install or after the first build:

1. Close Directory Opus (tray icon → Exit, or `dopusrt /closeprogram`).
2. Copy `build-out\Release\mdWorX.dll` and `build-out\mdWorX_assets\` into `C:\Program Files\GPSoftware\Directory Opus\Viewers\`. Requires admin (UAC prompt).
3. Restart Directory Opus.
4. Confirm in Preferences → Plugins → Viewer that "Markdown" appears.

The `release-bundle/mdWorX_v<version>/Install.cmd` script in a built release zip does this automatically (self-elevates, closes DOpus, copies, restarts). During development you don't have a release zip yet — use the manual copy above or `build.ps1 -Install` for the per-user path.

## Uninstall

1. Close DOpus.
2. Delete `C:\Program Files\GPSoftware\Directory Opus\Viewers\mdWorX.dll`.
3. Delete `C:\Program Files\GPSoftware\Directory Opus\Viewers\mdWorX_assets\`.
4. Optionally delete `%LOCALAPPDATA%\HyperWorX\mdWorX\` (WebView2 user data folder and any plugin cache).
5. Optionally delete `%APPDATA%\HyperWorX\mdWorX\` (user settings file and saved custom themes).
6. Restart DOpus.

The `release-bundle/mdWorX_v<version>/Uninstall.cmd` script (shipped in built release zips) does the same automatically.

No registry keys are written by the plugin (USB-safe).
