mdWorX - markdown viewer and editor for Directory Opus
========================================================

Version 0.1.1
Released 2026-05-26

Quick install
-------------

1. Quit Directory Opus.
2. Extract this zip anywhere (Desktop is fine).
3. Double-click Install.cmd and accept the UAC prompt.
4. DOpus relaunches automatically. Any .md / .markdown / .mdown / .mkd / .mkdn / .mdwn
   file now opens in the new viewer.

Uninstall
---------

Double-click Uninstall.cmd and accept the UAC prompt. Your settings file
and saved themes (under %APPDATA%\HyperWorX\mdWorX\) are left alone.
Delete that folder by hand if you want a full clean wipe.

Manual install (if you don't want to run the script)
----------------------------------------------------

Copy the contents of this zip into:

    C:\Program Files\GPSoftware\Directory Opus\Viewers\

End state in that folder:
    Viewers\mdWorX.dll
    Viewers\mdWorX_assets\   (folder containing index.html, viewer.js etc.)

You'll need admin rights to write to Program Files. Quit DOpus first or the DLL
will be locked.

What it does
------------

- Three view modes: Reading (rendered HTML), Live (per-line marker reveal -
  formatting stays visible until your cursor enters a line), and Source (raw
  markdown).
- Split screen in Source mode: source on the left, live preview on the right,
  with a draggable middle handle and a link/unlink toggle for scroll syncing.
- Editing toolbar with the full set of formatting actions: bold, italic,
  strikethrough, inline code, link, footnote, H1 / H2 / H3, bulleted /
  numbered / task lists, outdent / indent, blockquote, fenced code block, and
  image insert.
- Image insert popup: pick a file with Browse..., set alt text, optional width
  and height in px, alignment (none / left / centre / right), and a "Copy
  file to this document's folder" option that vendors the picked file next to
  the markdown and inserts a relative path.
- Obsidian-compatible image alt-text syntax: ![alt|640](path),
  ![alt|400x300](path), and ![alt|400x300|center](path) work in both Reading
  and Live mode. Windows absolute paths (C:\images\photo.png) resolve.
- Settings dialog (gear icon in top toolbar): full visual editor for every
  colour, font, size, margin, page surface, and layout option. No JSON
  hand-editing required.
- Palette system: 29 built-in palettes (17 dark + 12 light) including
  Dracula, Solarized, Nord, Gruvbox, Tokyo Night, Ayu, Catppuccin, GitHub,
  One Dark/Light, Obsidianite, AnuPpuccin Frappe, Everforest, Rose Pine,
  Vesper, Red Rascal, Alucard, PLN Dark/Light, and more. Save your tweaked
  colours as a named theme; deleted themes only affect your own (built-ins
  cannot be deleted).
- Heading underline thickness and style (solid / gradient / none) as a
  separate setting from horizontal-rule thickness.
- Show formatting characters toggle: reveals every space, tab, and line
  ending in Live mode, with LF / CRLF badges so you can tell line-ending
  conventions apart.
- Hard line breaks toggle: choose whether a single newline renders as a
  visible break or flows as soft whitespace.
- Page shadow depth + independent page-border colour and thickness controls.
- Inline mark colours per palette: bold, italic, strikethrough, and inline
  code each have their own colour entries that follow the active palette.
- Save and Save As. Quick heads-up: save before clicking off the file in the
  in-pane viewer, or unsaved edits are gone when the pane reloads with the
  new selection. The pop-out window doesn't have this problem.
- Word-wrap toggle in the top toolbar - flip long code lines and URLs from
  horizontal-scroll to wrap-to-pane.
- Copy button on every rendered code block, top-right corner.
- Works in both the DOpus viewer pane and a pop-out window (double-click the
  file).
- Encoding support: auto-detects UTF-8 / UTF-16 (LE/BE) via BOM, with a
  configurable fallback codepage (CP1250-CP1258, Shift-JIS, GBK, Big5,
  EUC-KR, ISO-8859-1/2/15, KOI8-R/U, system ANSI) for legacy files. Renders
  Arabic, Hebrew, CJK, Devanagari, Thai, Greek and mixed bidirectional
  content correctly. Save currently writes UTF-8 / UTF-8-BOM only
  (legacy-codepage and UTF-16 save not yet implemented).
- Full GFM extensions + plugins: tables, task lists, footnotes (editable in
  place), definition lists, abbreviations, mark / highlight, sub / sup,
  syntax highlighting via Shiki, copy buttons on code blocks.

Notes
-----

- The assets folder is named "mdWorX_assets". The DLL looks for it under
  that exact name (hardcoded path lookup), so don't rename it.
- DOpus identifies the plugin by GUID, not filename, so any older filename
  upgrade is transparent.
- User settings live at %APPDATA%\HyperWorX\mdWorX\settings.json.
  Custom themes live at %APPDATA%\HyperWorX\mdWorX\themes\<name>.json.
- WebView2 user data cache at %LOCALAPPDATA%\HyperWorX\mdWorX\.
- No registry keys written by the plugin.

Licence
-------

MIT. (c) 2026 HyperWorX.
