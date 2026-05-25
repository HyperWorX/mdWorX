# mdWorX v0.1.1

Released: 2026-05-26

## New features

- **Editor toolbar expanded.** New buttons for task lists, indent/outdent, fenced code blocks, footnotes, and image insertion. The image button opens a popup with Browse, alt text, width/height, alignment, and an option to copy the file into the document's folder.
- **Obsidian-style image syntax.** `![alt|400x300|center](path)` now sets dimensions and alignment in one go, working identically in Reading and Live. Windows absolute paths (e.g. `C:\images\photo.png`) now resolve correctly.
- **Save your own palettes, styles, and themes.** A Save menu in settings lets you keep the current configuration as a colour-only palette, a typography-and-layout style, or a full theme. Saved entries persist between sessions and show up in the preset picker.
- **Show formatting characters.** A Live-mode overlay reveals every space, tab, and line ending in your file, with LF/CRLF badges so you can tell line-ending conventions apart.
- **Hard line breaks toggle.** Choose whether a single newline renders as a visible break in Reading mode or flows as soft whitespace.
- **Page shadow and border controls.** Adjustable shadow depth plus independent colour and thickness for the page outline.
- **Inline mark colours per palette.** Bold, italic, strikethrough, and inline code each have their own colour entries that follow the active palette.
- **Heading underline thickness.** Separate control from the horizontal-rule thickness, with a new default gradient style.

## Palettes

- Eight new palettes added: Obsidianite, Obsidianite Light, AnuPpuccin Frappé, Everforest, Rosé Pine, Vesper, Red Rascal, and One Light.
- Existing palettes refined for better contrast against AA standards, particularly accent, link, and heading colours on lighter backgrounds.

## Improvements

- **Settings dialog overhauled.** Hover tooltips on every setting, a live colour preview that repaints as you scroll palettes, and input fields that stay readable on any palette.
- **Palette-aware chrome.** Headings, horizontal rules, page borders, and section underlines now follow the active palette instead of a fixed colour.
- **Reading and Live parity.** Lists, images, and spacing render consistently between the two modes.
- **Source-mode whitespace markers softened.** Faint space dots and tab arrows are now half as visible so they sit quietly in the background.

## Fixes

- Preset picker no longer reverts to a stale palette name after picking a default.
- Syntax highlighting in rendered code blocks restored.
- Double-underline on Live headings removed.

## Also

Plus a swag of smaller cosmetic refinements throughout (heading spacing, gradient underlines, highlight colour, dropdown carets, slider sizing, README rewrite, and similar polish).

## Install

Download `mdWorX_v0.1.1.zip`, extract, and run `Install.cmd`. Full instructions in the bundled `README.txt`, or in the repository [README](README.md).

## Build from source

```powershell
cd web
npm install
npm run build

cd ../plugin
.\build.ps1
```

See [`docs/dev-setup.md`](docs/dev-setup.md) for the full toolchain setup.
