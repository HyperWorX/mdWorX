mdWorX - markdown viewer and editor for Directory Opus
========================================================

Quick install
-------------

1. Quit Directory Opus.
2. Extract this zip anywhere (Desktop is fine).
3. Double-click Install.cmd and accept the UAC prompt.
4. DOpus relaunches automatically. Any .md / .markdown / .mdown / .mkd / .mkdn / .mdwn
   file now opens in the new viewer.

Uninstall
---------

Double-click Uninstall.cmd and accept the UAC prompt.

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

- Three view modes: Reading (rendered HTML), Live (Obsidian-style preview where
  formatting stays visible until your cursor enters a line), and Source (raw markdown).
- Split screen in Source mode: source on the left, live preview on the right, with
  a draggable middle handle and a link/unlink toggle for scroll syncing.
- In-place editing with a formatting toolbar (B/I/S, headings, lists, quote, link,
  footnote).
- Save and Save As. Quick heads-up: save before clicking off the file or you'll
  lose your edits.
- Word-wrap toggle in the top toolbar — flip long code lines and URLs from
  horizontal-scroll to wrap-to-pane.
- Copy button on every rendered code block (hover to reveal, top-right corner).
- Works in both the DOpus viewer pane and its own pop-out window.
- Multiple built-in themes; UI accent re-tints to match your palette.
- Toolbars hide their scrollbar UI and slide horizontally when the pane is too
  narrow to fit every button.
- Encoding support: auto-detects UTF-8 / UTF-16 (LE/BE) via BOM, with a
  configurable fallback codepage (CP1252, Shift-JIS, GBK, Big5, EUC-KR, system
  ANSI) for legacy files. Renders Arabic, Hebrew, CJK, Devanagari, Thai, Greek
  and mixed bidirectional content correctly. Save currently writes UTF-8 /
  UTF-8-BOM only (legacy-codepage and UTF-16 save not yet implemented).
- Full GFM extensions: tables, task lists, footnotes, definition lists,
  abbreviations, mark/highlight, sub/sup.

Notes
-----

- The assets folder is named "mdWorX_assets". The DLL looks for it under that
  exact name (hardcoded path lookup), so don't rename it.
- DOpus identifies the plugin by GUID, not filename, so this rename from any
  older filename is transparent if you previously had an older version installed.

Licence
-------

MIT. (c) 2026 HyperWorX.
