# Changelog

Running record of changes to mdWorX. Newest entries first.

## 2026-05-27 — v0.2.0 work in progress on `feature/v0.2.0`

Substantial UX additions building on top of v0.1.2. Branch is open for
testing in the live DOpus install and is not yet merged or released.

### Added

- **Fenced-code syntax highlighting across all three modes.** One Lezer-
  based highlighter (`web/src/lib/code-highlight.js`) drives Reading
  mode, Live mode, and the CM6 source-mode editor. All three emit the
  same `tok-*` class names so a single CSS stylesheet skins every block.
  Languages: javascript / typescript (+ jsx / tsx), python, rust, go,
  c / cpp, sql, json, yaml, xml, html, css, markdown. Plus shell / bash,
  diff, ini, and toml via `@codemirror/legacy-modes`.
- **`--code-<role>` palette variables** for nine token roles: keyword,
  string, comment, number, function, type, operator, variable,
  punctuation. Light and dark theme defaults live in `viewer.css`. Per
  palette overrides flow through the same `--code-<role>-override` path
  used by the rest of the palette system.
- **Code-theme picker** (`web/src/lib/code-themes.js`). Ten built-in
  themes: GitHub Light, GitHub Dark, Solarized Light, Solarized Dark,
  Monokai, Dracula, Nord, Tomorrow, Tomorrow Night, One Dark. New
  `codeBlockTheme` setting in the dialog, default `match-palette`.
- **Toolbar customisation**. Both the top toolbar and the formatting
  toolbar can be re-ordered and have individual buttons hidden. The
  settings dialog grows a `toolbar-layout` row type per toolbar, with
  up / down / visibility controls. Stored as `topToolbarLayout` /
  `editToolbarLayout` (null = manifest default). New buttons added in
  future versions append automatically rather than disappearing.
- **Auto-hide toolbars**. New `topToolbarMode` / `editToolbarMode`
  settings, options `always` / `auto-hide`. Auto-hide adds a 10px
  hot-zone strip (`#toolbar-hotzone`) at the top of the viewport; hover
  over the strip, the toolbar, or any element holding keyboard focus
  reveals the toolbar. Mouse leave + 400ms grace retracts it.

### Changed

- **`web/build.mjs`**: `settings.js` is now an esbuild entry point so it
  can use ES `import` (it consumes `lib/toolbar-manifest.js`). Output is
  still `dist/settings.js`, no change to the loaded script tag.
- **`web/src/settings.js`**: select-type field options now accept either
  bare strings (legacy form) or `{ value, label }` pairs so dropdowns
  can show a friendly display name while persisting a stable id.
- **`web/src/editor.js`**: nested-language colouring inside fenced code
  blocks now flows through the shared `codeHighlighter` instead of CM6's
  `defaultHighlightStyle`, so source-mode picks up palette-driven colours.
- **Plugin version**: `plugin/CMakeLists.txt`, `plugin/src/plugin.rc`,
  and `web/package.json` bumped to 0.2.0.

### Tracked-but-shipped-late

- The `check-for-updates` web UI (button, version label, message
  handlers in `settings.{html,css,js}`) was bundled into the v0.1.2
  release zip but never committed. The first commit on
  `feature/v0.2.0` (`e49933d`) tracks those changes so anyone building
  from source matches the published zip.

### Files affected

| Path | Change |
|---|---|
| `plugin/CMakeLists.txt` | Version 0.2.0 |
| `plugin/src/plugin.rc` | Version 0.2.0.0 |
| `web/package.json` + `package-lock.json` | New CM6 lang packages, legacy-modes, version 0.2.0 |
| `web/build.mjs` | settings.js as bundled entry point |
| `web/src/lib/code-highlight.js` | New, shared Lezer highlighter |
| `web/src/lib/code-themes.js` | New, 10 baked-in code-theme presets |
| `web/src/lib/toolbar-manifest.js` | New, button registry |
| `web/src/lib/toolbar-layout.js` | New, apply user layout to live DOM |
| `web/src/lib/markdown-it-shared.js` | Fence rule override to use shared highlighter |
| `web/src/livepreview/fenced-code.js` | Drops private language map, uses shared module |
| `web/src/editor.js` | classHighlighter for nested-language colouring |
| `web/src/viewer.js` | Wires code theme + toolbar layouts + auto-hide |
| `web/src/viewer.css` | `--code-*` vars, `.tok-*` selectors, auto-hide CSS |
| `web/src/index.html` | `#toolbar-hotzone` strip |
| `web/src/settings.js` | New schema entries, custom toolbar-layout row type |
| `web/src/settings.css` | Toolbar-layout list styles |
| `web/src/settings-defaults.json` | New `codeBlockTheme`, `topToolbarLayout`, `editToolbarLayout`, `topToolbarMode`, `editToolbarMode` |
| `web/src/settings.html` (orphan-tracking commit) | Update-check button + status row already in the v0.1.2 zip |
| `release-bundle/mdWorX_v0.1.2/mdWorX_assets/settings.*` (orphan-tracking commit) | Same update-check UI mirrored into the bundle directory |

### Context

Session topic: planning and implementing the next mdWorX release. The
user asked for three additions worth a minor version bump (0.1.2 →
0.2.0):

1. Auto-hide toolbars with a per-toolbar setting.
2. Rearrange / hide individual toolbar buttons.
3. Fenced code-block syntax highlighting that adapts to the chosen
   palette, with optional preset code themes alongside.

Architectural choice: one Lezer parser per language used in BOTH Reading
mode (markdown-it fence rule) and Live mode (CM6 widget), routed through
`code-highlight.js`. This was preferred over a Prism-based reading-mode
highlighter because the project already had Lezer parsers loaded for
Live mode, sharing one path keeps the two modes byte-identical, and the
class-based output (`tok-keyword`, etc.) is trivial to retheme via CSS
variables. Shiki was rejected because it inlines colours at tokenise
time, which would have required re-running the highlighter on every
palette change.

The orphan check-for-updates UI was discovered uncommitted on the
working tree at the start of the session. Native side was already in
main since `fcc04e1`; only the JS / HTML / CSS had been skipped. The
decision was to carry those changes onto `feature/v0.2.0` as its first
commit rather than backfill main, since v0.1.2 is past and the
published zip already has the feature for end users.

Branch is pushed to `origin/feature/v0.2.0`. No PR yet, no merge, no
tag — testing happens in the live DOpus install (`build.ps1 -Install`
copies the DLL to `%APPDATA%\GPSoftware\Directory Opus\Viewers`; web
assets are staged at the same path under `mdWorX_assets/`).
