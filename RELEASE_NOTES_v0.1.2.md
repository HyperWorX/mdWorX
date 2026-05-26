# mdWorX v0.1.2

Released: 2026-05-26

Focused incremental release covering the image-insert workflow and the new save / persistence behaviours.

## New features

- **Image insert popup accepts URLs.** Paste any `http(s)` URL into the source field and the popup auto-ticks "Copy to file folder". The image downloads into the markdown's folder and the saved syntax stays self-contained — no third-party host reference, no fetch on subsequent opens.
- **Magic-byte type detection on downloaded images.** Sniffs the actual format from the bytes (PNG / JPEG / GIF / WebP / BMP / ICO / SVG / AVIF / HEIC). Rejects responses that aren't valid images (HTML 404 pages, redirects), corrects the file extension when the URL lied about it, and falls back to a collision-safe filename when the destination already has a file with the same name.
- **Remote-image privacy gate.** New "Allow remote images" setting (off by default) keeps `![alt](https://...)` references in markdown from triggering any network request — they render as a placeholder icon, so the hosting server can't learn you opened a document. Flip it on per environment when you trust the source.
- **Session-scoped unsaved-edit persistence.** Edit a file in the viewer pane, click another file, click back — your unsaved edits are still there. A banner asks whether to keep them or reload the disk version. The stash lives only for the current DOpus run; closing DOpus clears it. Cleared on save. Pop-out windows are independent (they only edit one file each).
- **Conflict detection on file return.** If the file was modified externally while you were viewing another preview, the banner says so explicitly. The editor under the banner shows your in-progress edits; the disk content is one click away via "Reload from disk".
- **"Always reload external changes" setting.** Skip the banner on file-return and always use the disk version. In-dialog toast warning appears when you tick the box explaining that unsaved edits will be discarded under this mode. Useful when you frequently use an external editor on the same file.
- **Auto-save setting.** Pick a minute interval (0 disables) in Document handling and mdWorX runs a Ctrl+S equivalent on that schedule whenever the buffer is dirty. Same save path as the toolbar button; never writes if nothing has changed since the last save.

## Improvements

- **Toolbar wheel scroll.** When either toolbar overflows the viewport on a narrow window, a normal vertical mouse-wheel scroll moves the toolbar horizontally instead of leaking through to scroll the page underneath.
- **Banner only when the stash differs from disk.** The conflict banner is suppressed when your stashed buffer is byte-identical to the current disk content — no useless prompts when there's nothing to choose between.

## Fixes

- Settings dialog opened via Directory Opus Preferences → Plugins → mdWorX → Configure now closes cleanly ([#3](https://github.com/HyperWorX/mdWorX/issues/3), thanks to [@iamlimeng](https://github.com/iamlimeng) for the report and [@PolarGoose](https://github.com/PolarGoose) for the fix pattern).
- Live-mode image widget renders immediately after Insert — the caret sitting exactly at the closing `)` no longer counts as "inside" the image syntax, so the placeholder syntax doesn't linger on screen.
- Setext-style headings (`Title\n====`) no longer paint a double underline.

## Install

Download `mdWorX_v0.1.2.zip`, extract, and run `Install.cmd`. Full instructions in the bundled `README.txt` or in the repository [README](README.md).

## Build from source

```powershell
cd web
npm install
npm run build

cd ../plugin
./build.ps1
```
